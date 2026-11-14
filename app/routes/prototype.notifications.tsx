/**
 * PROTOTYPE — throwaway. Answers wayfinder ticket #7: "What does the in-app
 * notification feed look like in Cadence?"
 *
 * Three radically different takes on the same six first-release Notification
 * types (see map #1 / decision #2), switchable via ?variant=A|B|C and the
 * floating bar at the bottom. Each variant renders: the bell + unread badge,
 * the dropdown feed, read/unread states, per-type item layouts, a toast for a
 * live arrival ("Simulate arrival" button), and a dedicated notifications page.
 *
 *   A — Dropdown-first glance list (Linear / GitHub style)
 *   B — Two-pane triage inbox (email-client style)
 *   C — Grouped activity stream (category cards)
 *
 * Self-contained: lives outside the app layout so it needs no auth/session.
 * No persistence — read state is in-memory and resets on reload. NOT production
 * code (no tests, no error handling). Delete when the design decision lands.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Toaster, toast } from "sonner";
import {
  Bell,
  Receipt,
  CheckCircle2,
  XCircle,
  UserPlus,
  MessageSquare,
  MessageSquareReply,
  ChevronLeft,
  ChevronRight,
  Check,
  Circle,
  Lock,
  ArrowLeft,
} from "lucide-react";
import { cn } from "~/lib/utils";

/* ------------------------------------------------------------------ data --- */

type NotifType =
  | "refund_opened"
  | "refund_approved"
  | "refund_declined"
  | "enrollment"
  | "question_posted"
  | "question_answered";

interface Notif {
  id: number;
  type: NotifType;
  recipientRole: string; // whose feed this belongs in (real types are 1:1 with a role)
  actor: string; // who/what triggered it
  title: string;
  detail: string;
  course?: string;
  amount?: string;
  at: string; // relative, for display only
  bucket: "today" | "earlier";
  read: boolean;
  transactional?: boolean; // Refund approved/declined — always emailed, exempt from Mute
  action?: string; // the one thing the recipient can do
}

const TYPE_META: Record<
  NotifType,
  { label: string; icon: typeof Bell; tint: string; chip: string }
> = {
  refund_opened: {
    label: "Refund request",
    icon: Receipt,
    tint: "text-amber-600",
    chip: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  },
  refund_approved: {
    label: "Refund approved",
    icon: CheckCircle2,
    tint: "text-emerald-600",
    chip: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  },
  refund_declined: {
    label: "Refund declined",
    icon: XCircle,
    tint: "text-rose-600",
    chip: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
  },
  enrollment: {
    label: "New enrollment",
    icon: UserPlus,
    tint: "text-sky-600",
    chip: "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
  },
  question_posted: {
    label: "Question posted",
    icon: MessageSquare,
    tint: "text-violet-600",
    chip: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
  },
  question_answered: {
    label: "Question answered",
    icon: MessageSquareReply,
    tint: "text-indigo-600",
    chip: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300",
  },
};

// One of each of the six first-release types, plus a few repeats so the feed
// has realistic density. recipientRole is informational — a real user only ever
// sees their own types; mixing them here lets us judge every item layout at once.
const SEED: Notif[] = [
  {
    id: 1,
    type: "question_posted",
    recipientRole: "Instructor",
    actor: "Dana Okoro",
    title: "Dana asked a question on “Promises & async/await”",
    detail:
      "“When I await inside a forEach the loop doesn't wait — is that expected?”",
    course: "Modern JavaScript",
    at: "3m ago",
    bucket: "today",
    read: false,
    action: "Answer question",
  },
  {
    id: 2,
    type: "refund_opened",
    recipientRole: "Platform Admin",
    actor: "Priya Raman",
    title: "Refund request opened",
    detail: "Priya requested a refund for “Design Systems in Figma”.",
    course: "Design Systems in Figma",
    amount: "$79.00",
    at: "25m ago",
    bucket: "today",
    read: false,
    action: "Review request",
  },
  {
    id: 3,
    type: "enrollment",
    recipientRole: "Instructor",
    actor: "Marcus Lee",
    title: "New enrollment on “Modern JavaScript”",
    detail: "Marcus enrolled via individual purchase.",
    course: "Modern JavaScript",
    at: "1h ago",
    bucket: "today",
    read: false,
  },
  {
    id: 4,
    type: "refund_approved",
    recipientRole: "Student",
    actor: "Cadence",
    title: "Your refund was approved",
    detail: "We've refunded your purchase of “Intro to SQL”.",
    course: "Intro to SQL",
    amount: "$49.00",
    at: "2h ago",
    bucket: "today",
    read: true,
    transactional: true,
    action: "View receipt",
  },
  {
    id: 5,
    type: "question_answered",
    recipientRole: "Student",
    actor: "Sofia Alvarez",
    title: "Sofia answered your question",
    detail: "On “CSS Grid vs Flexbox” in lesson 4.",
    course: "Responsive Layouts",
    at: "Yesterday",
    bucket: "earlier",
    read: true,
    action: "View answer",
  },
  {
    id: 6,
    type: "refund_declined",
    recipientRole: "Team Admin",
    actor: "Cadence",
    title: "Your refund request was declined",
    detail:
      "The request for “Kubernetes at Scale” (3 seats) falls outside the refund window.",
    course: "Kubernetes at Scale",
    amount: "$450.00",
    at: "Yesterday",
    bucket: "earlier",
    read: true,
    transactional: true,
    action: "View details",
  },
  {
    id: 7,
    type: "enrollment",
    recipientRole: "Instructor",
    actor: "Acme Corp (team licence)",
    title: "New enrollment on “Kubernetes at Scale”",
    detail: "A seat was claimed under the Acme Corp team licence.",
    course: "Kubernetes at Scale",
    at: "2d ago",
    bucket: "earlier",
    read: true,
  },
  {
    id: 8,
    type: "question_posted",
    recipientRole: "Instructor",
    actor: "Leo Fischer",
    title: "Leo asked a question on “Indexes & query plans”",
    detail: "“Does a composite index help if I only filter on the 2nd column?”",
    course: "Intro to SQL",
    at: "2d ago",
    bucket: "earlier",
    read: true,
    action: "Answer question",
  },
];

// Pool of fresh arrivals the "Simulate arrival" button cycles through.
const ARRIVALS: Omit<Notif, "id" | "read" | "bucket">[] = [
  {
    type: "question_posted",
    recipientRole: "Instructor",
    actor: "Yuki Tanaka",
    title: "Yuki asked a question on “Event loop internals”",
    detail: "“Why does setTimeout(…, 0) run after a resolved Promise?”",
    course: "Modern JavaScript",
    at: "just now",
    action: "Answer question",
  },
  {
    type: "refund_opened",
    recipientRole: "Platform Admin",
    actor: "Omar Haddad",
    title: "Refund request opened",
    detail: "Omar requested a refund for “Modern JavaScript”.",
    course: "Modern JavaScript",
    amount: "$59.00",
    at: "just now",
    action: "Review request",
  },
  {
    type: "enrollment",
    recipientRole: "Instructor",
    actor: "Nina Petrova",
    title: "New enrollment on “Design Systems in Figma”",
    detail: "Nina enrolled via individual purchase.",
    course: "Design Systems in Figma",
    at: "just now",
  },
];

function relTime(n: Notif) {
  return n.at;
}

/* ------------------------------------------------------- shared behaviour --- */

function useNotifications() {
  const [items, setItems] = useState<Notif[]>(SEED);
  const nextId = useRef(100);
  const arrivalIdx = useRef(0);

  const unread = items.filter((i) => !i.read).length;

  function markRead(id: number) {
    setItems((xs) => xs.map((x) => (x.id === id ? { ...x, read: true } : x)));
  }
  function markAllRead() {
    setItems((xs) => xs.map((x) => ({ ...x, read: true })));
  }
  function simulateArrival() {
    const tmpl = ARRIVALS[arrivalIdx.current % ARRIVALS.length];
    arrivalIdx.current += 1;
    const id = nextId.current++;
    const notif: Notif = { ...tmpl, id, read: false, bucket: "today" };
    setItems((xs) => [notif, ...xs]);
    const meta = TYPE_META[notif.type];
    toast(notif.title, {
      description: notif.detail,
      icon: <meta.icon className={cn("size-4", meta.tint)} />,
      action: notif.action
        ? { label: notif.action, onClick: () => markRead(id) }
        : undefined,
    });
  }

  return { items, unread, markRead, markAllRead, simulateArrival };
}

type NotifStore = ReturnType<typeof useNotifications>;

/* --------------------------------------------------------- small helpers --- */

function TypeIcon({ type, className }: { type: NotifType; className?: string }) {
  const meta = TYPE_META[type];
  const Icon = meta.icon;
  return <Icon className={cn("size-4", meta.tint, className)} />;
}

function BellButton({
  unread,
  open,
  onClick,
}: {
  unread: number;
  open: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "relative grid size-9 place-items-center rounded-full text-foreground/70 transition-colors hover:bg-accent hover:text-foreground",
        open && "bg-accent text-foreground"
      )}
      aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
    >
      <Bell className="size-5" />
      {unread > 0 && (
        <span className="absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] font-bold leading-4 text-white">
          {unread > 9 ? "9+" : unread}
        </span>
      )}
    </button>
  );
}

function TopBar({
  store,
  children,
}: {
  store: NotifStore;
  children: React.ReactNode;
}) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-6">
      <div className="text-sm text-muted-foreground">
        Prototype shell — the bar below swaps the whole treatment
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={store.simulateArrival}
          className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground/80 transition-colors hover:bg-accent"
        >
          Simulate arrival
        </button>
        {children}
      </div>
    </header>
  );
}

/* Reusable dropdown shell anchored to the bell. */
function Dropdown({
  open,
  onClose,
  children,
  width = "w-96",
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  width?: string;
}) {
  if (!open) return null;
  return (
    <>
      <div className="fixed inset-0 z-10" onClick={onClose} />
      <div
        className={cn(
          "absolute right-0 top-11 z-20 overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-xl",
          width
        )}
      >
        {children}
      </div>
    </>
  );
}

/* ============================================================ VARIANT A === */
/* Dropdown-first glance list. The bell panel is the hero; the page is a
   simple single-column mirror of it. Unread = tinted row + left dot. */

function VariantA({ store }: { store: NotifStore }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const today = store.items.filter((i) => i.bucket === "today");
  const earlier = store.items.filter((i) => i.bucket === "earlier");

  function Row({ n }: { n: Notif }) {
    return (
      <button
        onClick={() => store.markRead(n.id)}
        className={cn(
          "flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/60",
          !n.read && "bg-primary/[0.04]"
        )}
      >
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">
          <TypeIcon type={n.type} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span
              className={cn(
                "truncate text-sm",
                n.read ? "font-normal text-foreground/80" : "font-semibold"
              )}
            >
              {n.title}
            </span>
            {n.transactional && (
              <Lock className="size-3 shrink-0 text-muted-foreground" />
            )}
          </span>
          <span className="mt-0.5 line-clamp-1 block text-xs text-muted-foreground">
            {n.detail}
          </span>
          <span className="mt-1 block text-[11px] text-muted-foreground/70">
            {relTime(n)}
          </span>
        </span>
        {!n.read && (
          <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />
        )}
      </button>
    );
  }

  return (
    <div className="relative">
      <BellButton
        unread={store.unread}
        open={open}
        onClick={() => setOpen((o) => !o)}
      />
      <Dropdown open={open} onClose={() => setOpen(false)}>
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="text-sm font-semibold">Notifications</span>
          <button
            onClick={store.markAllRead}
            className="text-xs font-medium text-primary hover:underline"
          >
            Mark all read
          </button>
        </div>
        <div className="max-h-96 overflow-y-auto">
          {today.length > 0 && (
            <div className="bg-muted/40 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Today
            </div>
          )}
          {today.map((n) => (
            <Row key={n.id} n={n} />
          ))}
          {earlier.length > 0 && (
            <div className="bg-muted/40 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Earlier
            </div>
          )}
          {earlier.map((n) => (
            <Row key={n.id} n={n} />
          ))}
        </div>
        <button
          onClick={() => {
            setOpen(false);
            navigate("/prototype/notifications?variant=A&page=1");
          }}
          className="block w-full border-t border-border py-3 text-center text-xs font-medium text-primary hover:bg-accent"
        >
          View all notifications
        </button>
      </Dropdown>
    </div>
  );
}

function VariantAPage({ store }: { store: NotifStore }) {
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const shown = store.items.filter((i) => (filter === "unread" ? !i.read : true));
  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Notifications</h1>
        <button
          onClick={store.markAllRead}
          className="text-sm font-medium text-primary hover:underline"
        >
          Mark all read
        </button>
      </div>
      <div className="mb-4 inline-flex rounded-lg border border-border p-0.5 text-sm">
        {(["all", "unread"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              "rounded-md px-3 py-1 capitalize transition-colors",
              filter === f
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {f}
            {f === "unread" && store.unread > 0 ? ` (${store.unread})` : ""}
          </button>
        ))}
      </div>
      <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
        {shown.map((n) => (
          <button
            key={n.id}
            onClick={() => store.markRead(n.id)}
            className={cn(
              "flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-accent/60",
              !n.read && "bg-primary/[0.04]"
            )}
          >
            <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-muted">
              <TypeIcon type={n.type} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className={cn("text-sm", !n.read && "font-semibold")}>
                  {n.title}
                </span>
                {n.transactional && (
                  <span className="rounded bg-muted px-1.5 py-px text-[10px] font-medium text-muted-foreground">
                    Transactional
                  </span>
                )}
              </span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {n.detail}
              </span>
              <span className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground/70">
                <span>{relTime(n)}</span>
                {n.action && (
                  <span className="font-medium text-primary">{n.action} →</span>
                )}
              </span>
            </span>
            {!n.read && (
              <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />
            )}
          </button>
        ))}
        {shown.length === 0 && (
          <div className="px-4 py-12 text-center text-sm text-muted-foreground">
            Nothing unread. You're all caught up.
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================================================ VARIANT B === */
/* Two-pane triage inbox. The page is the hero: list on the left, full detail +
   primary action on the right. Unread = bold + accent bar. The bell dropdown
   is deliberately thin — a nudge toward the inbox, not a second feed. */

function VariantB({ store }: { store: NotifStore }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const recent = store.items.slice(0, 4);
  return (
    <div className="relative">
      <BellButton
        unread={store.unread}
        open={open}
        onClick={() => setOpen((o) => !o)}
      />
      <Dropdown open={open} onClose={() => setOpen(false)} width="w-80">
        <div className="border-b border-border px-4 py-3 text-sm">
          <span className="font-semibold">{store.unread} new</span>{" "}
          <span className="text-muted-foreground">notifications</span>
        </div>
        <div className="divide-y divide-border">
          {recent.map((n) => (
            <div
              key={n.id}
              className="flex items-center gap-2 px-4 py-2.5 text-xs"
            >
              <TypeIcon type={n.type} className="size-3.5" />
              <span className={cn("truncate", !n.read && "font-semibold")}>
                {n.title}
              </span>
            </div>
          ))}
        </div>
        <button
          onClick={() => {
            setOpen(false);
            navigate("/prototype/notifications?variant=B&page=1");
          }}
          className="block w-full border-t border-border bg-primary py-2.5 text-center text-xs font-semibold text-primary-foreground hover:opacity-90"
        >
          Open inbox
        </button>
      </Dropdown>
    </div>
  );
}

function VariantBPage({ store }: { store: NotifStore }) {
  const [tab, setTab] = useState<"all" | "refunds" | "questions" | "enrollments">(
    "all"
  );
  const match = (n: Notif) =>
    tab === "all"
      ? true
      : tab === "refunds"
        ? n.type.startsWith("refund")
        : tab === "questions"
          ? n.type.startsWith("question")
          : n.type === "enrollment";
  const list = store.items.filter(match);
  const [selId, setSelId] = useState<number | null>(list[0]?.id ?? null);
  const selected =
    store.items.find((n) => n.id === selId) ?? list[0] ?? store.items[0];

  const tabs = [
    ["all", "All"],
    ["refunds", "Refunds"],
    ["questions", "Questions"],
    ["enrollments", "Enrollments"],
  ] as const;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-6 py-3">
        <div className="flex items-center gap-1">
          {tabs.map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm transition-colors",
                tab === key
                  ? "bg-accent font-medium text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          onClick={store.markAllRead}
          className="text-sm font-medium text-primary hover:underline"
        >
          Mark all read
        </button>
      </div>
      <div className="flex min-h-0 flex-1">
        {/* list pane */}
        <div className="w-80 shrink-0 divide-y divide-border overflow-y-auto border-r border-border">
          {list.map((n) => (
            <button
              key={n.id}
              onClick={() => {
                setSelId(n.id);
                store.markRead(n.id);
              }}
              className={cn(
                "flex w-full items-start gap-2 px-4 py-3 text-left transition-colors",
                selected?.id === n.id ? "bg-accent" : "hover:bg-accent/50"
              )}
            >
              <span
                className={cn(
                  "mt-1 h-10 w-1 shrink-0 rounded-full",
                  n.read ? "bg-transparent" : "bg-primary"
                )}
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 truncate">
                    <TypeIcon type={n.type} className="size-3.5" />
                    <span className="truncate text-xs text-muted-foreground">
                      {n.actor}
                    </span>
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-foreground/70">
                    {relTime(n)}
                  </span>
                </span>
                <span
                  className={cn(
                    "mt-1 line-clamp-1 block text-sm",
                    !n.read && "font-semibold"
                  )}
                >
                  {n.title}
                </span>
                <span className="mt-0.5 line-clamp-1 block text-xs text-muted-foreground">
                  {n.detail}
                </span>
              </span>
            </button>
          ))}
          {list.length === 0 && (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">
              Nothing here.
            </div>
          )}
        </div>
        {/* detail pane */}
        <div className="min-w-0 flex-1 overflow-y-auto p-8">
          {selected ? (
            <div className="mx-auto max-w-xl">
              <div className="mb-4 flex items-center gap-2">
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
                    TYPE_META[selected.type].chip
                  )}
                >
                  <TypeIcon type={selected.type} className="size-3.5" />
                  {TYPE_META[selected.type].label}
                </span>
                {selected.transactional && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
                    <Lock className="size-3" /> Transactional email
                  </span>
                )}
              </div>
              <h1 className="text-xl font-bold">{selected.title}</h1>
              <p className="mt-2 text-muted-foreground">{selected.detail}</p>
              <dl className="mt-6 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
                <dt className="text-muted-foreground">From</dt>
                <dd>{selected.actor}</dd>
                {selected.course && (
                  <>
                    <dt className="text-muted-foreground">Course</dt>
                    <dd>{selected.course}</dd>
                  </>
                )}
                {selected.amount && (
                  <>
                    <dt className="text-muted-foreground">Amount</dt>
                    <dd className="font-medium">{selected.amount}</dd>
                  </>
                )}
                <dt className="text-muted-foreground">Received</dt>
                <dd>{relTime(selected)}</dd>
                <dt className="text-muted-foreground">Goes to</dt>
                <dd>{selected.recipientRole}</dd>
              </dl>
              {selected.action && (
                <button className="mt-8 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90">
                  {selected.action}
                </button>
              )}
            </div>
          ) : (
            <div className="grid h-full place-items-center text-sm text-muted-foreground">
              Select a notification
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ============================================================ VARIANT C === */
/* Grouped activity stream. Everything is organised by category, both in the
   bell panel (summary counts you expand) and on the page (rich cards per
   category). Read/unread shown by a filled vs hollow status dot. */

const CATEGORIES: {
  key: string;
  label: string;
  types: NotifType[];
}[] = [
  { key: "refunds", label: "Refunds", types: ["refund_opened", "refund_approved", "refund_declined"] },
  { key: "enrollments", label: "Enrollments", types: ["enrollment"] },
  { key: "questions", label: "Questions", types: ["question_posted", "question_answered"] },
];

function VariantC({ store }: { store: NotifStore }) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const navigate = useNavigate();

  return (
    <div className="relative">
      <BellButton
        unread={store.unread}
        open={open}
        onClick={() => setOpen((o) => !o)}
      />
      <Dropdown open={open} onClose={() => setOpen(false)}>
        <div className="border-b border-border px-4 py-3 text-sm font-semibold">
          Activity
        </div>
        <div className="divide-y divide-border">
          {CATEGORIES.map((cat) => {
            const items = store.items.filter((i) => cat.types.includes(i.type));
            const unread = items.filter((i) => !i.read).length;
            const isOpen = expanded === cat.key;
            return (
              <div key={cat.key}>
                <button
                  onClick={() => setExpanded(isOpen ? null : cat.key)}
                  className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-accent/50"
                >
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <TypeIcon type={cat.types[0]} />
                    {cat.label}
                  </span>
                  <span className="flex items-center gap-2">
                    {unread > 0 && (
                      <span className="rounded-full bg-primary px-2 text-xs font-semibold text-primary-foreground">
                        {unread}
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {items.length}
                    </span>
                  </span>
                </button>
                {isOpen && (
                  <div className="bg-muted/30 pb-1">
                    {items.map((n) => (
                      <button
                        key={n.id}
                        onClick={() => store.markRead(n.id)}
                        className="flex w-full items-center gap-2 px-6 py-2 text-left text-xs hover:bg-accent/50"
                      >
                        {n.read ? (
                          <Circle className="size-2.5 shrink-0 text-muted-foreground/40" />
                        ) : (
                          <span className="size-2.5 shrink-0 rounded-full bg-primary" />
                        )}
                        <span className={cn("truncate", !n.read && "font-medium")}>
                          {n.title}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <button
          onClick={() => {
            setOpen(false);
            navigate("/prototype/notifications?variant=C&page=1");
          }}
          className="block w-full border-t border-border py-3 text-center text-xs font-medium text-primary hover:bg-accent"
        >
          See all activity
        </button>
      </Dropdown>
    </div>
  );
}

function VariantCPage({ store }: { store: NotifStore }) {
  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Activity</h1>
        <button
          onClick={store.markAllRead}
          className="text-sm font-medium text-primary hover:underline"
        >
          Mark all read
        </button>
      </div>
      <div className="space-y-6">
        {CATEGORIES.map((cat) => {
          const items = store.items.filter((i) => cat.types.includes(i.type));
          if (items.length === 0) return null;
          const unread = items.filter((i) => !i.read).length;
          return (
            <section
              key={cat.key}
              className="overflow-hidden rounded-xl border border-border"
            >
              <div className="flex items-center justify-between border-b border-border bg-muted/40 px-5 py-3">
                <span className="flex items-center gap-2 font-semibold">
                  <TypeIcon type={cat.types[0]} />
                  {cat.label}
                </span>
                <span className="text-xs text-muted-foreground">
                  {unread > 0 ? `${unread} unread · ` : ""}
                  {items.length} total
                </span>
              </div>
              <div className="divide-y divide-border">
                {items.map((n) => (
                  <div
                    key={n.id}
                    className={cn(
                      "flex items-start gap-3 px-5 py-4",
                      !n.read && "bg-primary/[0.03]"
                    )}
                  >
                    <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-muted">
                      <TypeIcon type={n.type} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            "text-sm",
                            !n.read ? "font-semibold" : "text-foreground/80"
                          )}
                        >
                          {n.title}
                        </span>
                        {n.amount && (
                          <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium tabular-nums">
                            {n.amount}
                          </span>
                        )}
                        {n.transactional && (
                          <Lock className="size-3 text-muted-foreground" />
                        )}
                      </div>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        {n.detail}
                      </p>
                      <div className="mt-2 flex items-center gap-3 text-xs">
                        <span className="text-muted-foreground/70">
                          {relTime(n)}
                        </span>
                        {n.action && (
                          <button
                            onClick={() => store.markRead(n.id)}
                            className="rounded-md border border-border px-2 py-1 font-medium text-foreground/80 hover:bg-accent"
                          >
                            {n.action}
                          </button>
                        )}
                      </div>
                    </div>
                    {!n.read && (
                      <span className="mt-1 size-2 shrink-0 rounded-full bg-primary" />
                    )}
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------- the switcher --- */

const VARIANTS = [
  { key: "A", name: "Dropdown-first glance list" },
  { key: "B", name: "Two-pane triage inbox" },
  { key: "C", name: "Grouped activity stream" },
] as const;

function PrototypeSwitcher({ current }: { current: string }) {
  const [params, setParams] = useSearchParams();
  const idx = Math.max(
    0,
    VARIANTS.findIndex((v) => v.key === current)
  );

  function go(delta: number) {
    const next = VARIANTS[(idx + delta + VARIANTS.length) % VARIANTS.length];
    const p = new URLSearchParams(params);
    p.set("variant", next.key);
    p.delete("page"); // reset to the shell view on switch
    setParams(p, { replace: true });
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = document.activeElement;
      if (
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        (el as HTMLElement)?.isContentEditable
      )
        return;
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full border border-white/10 bg-neutral-900 px-1.5 py-1.5 text-white shadow-2xl">
      <button
        onClick={() => go(-1)}
        className="grid size-8 place-items-center rounded-full hover:bg-white/15"
        aria-label="Previous variant"
      >
        <ChevronLeft className="size-4" />
      </button>
      <span className="px-2 text-sm font-medium tabular-nums">
        {current} · {VARIANTS[idx].name}
      </span>
      <button
        onClick={() => go(1)}
        className="grid size-8 place-items-center rounded-full hover:bg-white/15"
        aria-label="Next variant"
      >
        <ChevronRight className="size-4" />
      </button>
    </div>
  );
}

/* --------------------------------------------------------------- the page --- */

export default function PrototypeNotifications() {
  const [params] = useSearchParams();
  const variant = (params.get("variant") ?? "A").toUpperCase();
  const onPage = params.get("page") === "1";
  const navigate = useNavigate();
  const store = useNotifications();

  const bell =
    variant === "B" ? (
      <VariantB store={store} />
    ) : variant === "C" ? (
      <VariantC store={store} />
    ) : (
      <VariantA store={store} />
    );

  const page =
    variant === "B" ? (
      <VariantBPage store={store} />
    ) : variant === "C" ? (
      <VariantCPage store={store} />
    ) : (
      <VariantAPage store={store} />
    );

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <TopBar store={store}>{bell}</TopBar>
      <main className="min-h-0 flex-1 overflow-y-auto">
        {onPage ? (
          <>
            <button
              onClick={() => navigate(`/prototype/notifications?variant=${variant}`)}
              className="mx-auto mt-4 flex max-w-3xl items-center gap-1.5 px-6 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="size-4" /> Back to shell
            </button>
            {page}
          </>
        ) : (
          <div className="grid h-full place-items-center p-6">
            <div className="max-w-md text-center">
              <div className="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-muted">
                <Bell className="size-6 text-muted-foreground" />
              </div>
              <h1 className="text-lg font-semibold">
                Variant {variant}: {VARIANTS.find((v) => v.key === variant)?.name}
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Open the bell (top-right) to see the feed. Hit{" "}
                <span className="font-medium text-foreground">Simulate arrival</span>{" "}
                for a live toast. The dropdown's footer link opens the dedicated
                notifications page. Use ← / → or the bar below to switch variants.
              </p>
              <div className="mt-4 flex items-center justify-center gap-1 text-xs text-muted-foreground">
                <Check className="size-3.5" /> {store.unread} unread of{" "}
                {store.items.length}
              </div>
            </div>
          </div>
        )}
      </main>
      <PrototypeSwitcher current={variant} />
      <Toaster position="bottom-right" closeButton />
    </div>
  );
}
