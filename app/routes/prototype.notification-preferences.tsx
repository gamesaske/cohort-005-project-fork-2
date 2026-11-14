/**
 * PROTOTYPE — throwaway. Answers wayfinder ticket #9: "What does the
 * notification *preferences* surface look like?"
 *
 * The preference model is already decided (map #1 / decision #6):
 *   - In-app is ALWAYS ON and never shown as a toggle.
 *   - Email is the ONLY tunable channel.
 *   - Per-type email overrides on role-filtered defaults
 *     (on for refund_opened / refund_approved / refund_declined /
 *      question_posted / question_answered; OFF for enrollment).
 *   - A per-course override layer for the course-scoped types
 *     (enrollment, question_posted, question_answered).
 *   - Refund approved/declined are Transactional: always emailed, no toggle,
 *     exempt from Mute.
 *   - A global "Mute all email" switch (email-only, transactional exempt).
 *   - Resolution order: muted → per-course → global per-type → default.
 *
 * The open design question is PRESENTATION: how to show per-type toggles, the
 * per-course layer, and the Mute switch without overwhelming. Three radically
 * different takes, switchable via ?variant=A|B|C and the floating bar:
 *
 *   A — Type-first list, per-course nested under each type (iOS-settings style)
 *   B — Matrix: course-scoped types × courses grid
 *   C — Course-first: pick a course, then toggle its types (accordion)
 *
 * Because preferences are role-filtered, a "Preview as role" control
 * (?role=student|instructor|admin) swaps the visible set so every role's view
 * can be judged. Instructor is the richest (two course-scoped types × courses).
 *
 * Self-contained: lives outside the app layout, no auth/session, no DB. State
 * is in-memory and resets on reload. NOT production code. Delete when the
 * design decision lands.
 */
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import {
  Bell,
  BellOff,
  Receipt,
  CheckCircle2,
  XCircle,
  UserPlus,
  MessageSquare,
  MessageSquareReply,
  Lock,
  Mail,
  Info,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
} from "lucide-react";
import { cn } from "~/lib/utils";
import { Card, CardContent, CardHeader } from "~/components/ui/card";

/* ------------------------------------------------------------------ model --- */

type PrefType =
  | "refund_opened"
  | "refund_approved"
  | "refund_declined"
  | "enrollment"
  | "question_posted"
  | "question_answered";

type Role = "Student" | "Instructor" | "Platform Admin";

interface TypeMeta {
  label: string;
  description: string;
  icon: typeof Bell;
  tint: string;
  role: Role;
  transactional: boolean;
  courseScoped: boolean;
  defaultOn: boolean;
}

// Visual language (icon + tint) matches the feed prototype (ticket #7).
const TYPE_META: Record<PrefType, TypeMeta> = {
  refund_opened: {
    label: "Refund request opened",
    description: "A buyer asked for a refund and it's waiting on you.",
    icon: Receipt,
    tint: "text-amber-600",
    role: "Platform Admin",
    transactional: false,
    courseScoped: false,
    defaultOn: true,
  },
  refund_approved: {
    label: "Refund approved",
    description: "We approved your refund and moved the money.",
    icon: CheckCircle2,
    tint: "text-emerald-600",
    role: "Student",
    transactional: true,
    courseScoped: false,
    defaultOn: true,
  },
  refund_declined: {
    label: "Refund declined",
    description: "We declined your refund request.",
    icon: XCircle,
    tint: "text-rose-600",
    role: "Student",
    transactional: true,
    courseScoped: false,
    defaultOn: true,
  },
  enrollment: {
    label: "New enrollment",
    description: "A student enrolled in one of your courses.",
    icon: UserPlus,
    tint: "text-sky-600",
    role: "Instructor",
    transactional: false,
    courseScoped: true,
    defaultOn: false,
  },
  question_posted: {
    label: "Question posted",
    description: "A student asked a question on one of your courses.",
    icon: MessageSquare,
    tint: "text-violet-600",
    role: "Instructor",
    transactional: false,
    courseScoped: true,
    defaultOn: true,
  },
  question_answered: {
    label: "Question answered",
    description: "An instructor answered your question.",
    icon: MessageSquareReply,
    tint: "text-indigo-600",
    role: "Student",
    transactional: false, // course-scoped, tunable
    courseScoped: true,
    defaultOn: true,
  },
};

const ORDER: PrefType[] = [
  "refund_opened",
  "refund_approved",
  "refund_declined",
  "enrollment",
  "question_posted",
  "question_answered",
];

interface Course {
  id: string;
  title: string;
}

// For an Instructor these are courses they teach; for a Student, courses they
// are enrolled in. One shared list keeps the prototype simple.
const COURSES: Course[] = [
  { id: "mjs", title: "Modern JavaScript" },
  { id: "dsf", title: "Design Systems in Figma" },
  { id: "sql", title: "Intro to SQL" },
];

function typesForRole(role: Role): PrefType[] {
  return ORDER.filter((t) => TYPE_META[t].role === role);
}

/* ------------------------------------------------------------------ store --- */

interface Store {
  muted: boolean;
  setMuted: (v: boolean) => void;
  // per-type global override; absent → use default
  globalByType: Partial<Record<PrefType, boolean>>;
  setGlobal: (t: PrefType, v: boolean) => void;
  // per-course override; absent → inherit the global per-type value
  perCourse: Partial<Record<PrefType, Record<string, boolean>>>;
  setCourse: (t: PrefType, courseId: string, v: boolean | undefined) => void;
  // resolved global value for a type (override else default)
  globalOf: (t: PrefType) => boolean;
  // the course override if one is set, else undefined (= inherits)
  courseOverride: (t: PrefType, courseId: string) => boolean | undefined;
  // fully resolved email-delivery state (muted → per-course → global → default)
  effective: (t: PrefType, courseId?: string) => boolean;
}

function useStore(): Store {
  const [muted, setMuted] = useState(false);
  const [globalByType, setGlobalByType] = useState<
    Partial<Record<PrefType, boolean>>
  >({});
  const [perCourse, setPerCourse] = useState<
    Partial<Record<PrefType, Record<string, boolean>>>
  >({});

  function globalOf(t: PrefType) {
    return globalByType[t] ?? TYPE_META[t].defaultOn;
  }
  function courseOverride(t: PrefType, courseId: string) {
    return perCourse[t]?.[courseId];
  }
  function effective(t: PrefType, courseId?: string) {
    if (TYPE_META[t].transactional) return true; // always emailed, Mute-exempt
    if (muted) return false; // Mute wins over everything tunable
    if (courseId !== undefined) {
      const ov = courseOverride(t, courseId);
      if (ov !== undefined) return ov; // per-course layer
    }
    return globalOf(t); // global per-type → default
  }

  return {
    muted,
    setMuted,
    globalByType,
    setGlobal: (t, v) => setGlobalByType((s) => ({ ...s, [t]: v })),
    perCourse,
    setCourse: (t, courseId, v) =>
      setPerCourse((s) => {
        const next = { ...(s[t] ?? {}) };
        if (v === undefined) delete next[courseId];
        else next[courseId] = v;
        return { ...s, [t]: next };
      }),
    globalOf,
    courseOverride,
    effective,
  };
}

/* ------------------------------------------------------------------ atoms --- */

function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
        checked ? "bg-primary" : "bg-muted-foreground/30",
        disabled && "cursor-not-allowed opacity-40"
      )}
    >
      <span
        className={cn(
          "inline-block size-5 transform rounded-full bg-white shadow transition-transform",
          checked ? "translate-x-5" : "translate-x-0.5"
        )}
      />
    </button>
  );
}

function TypeIcon({ type }: { type: PrefType }) {
  const m = TYPE_META[type];
  const Icon = m.icon;
  return (
    <span
      className={cn(
        "grid size-9 shrink-0 place-items-center rounded-lg bg-muted",
        m.tint
      )}
    >
      <Icon className="size-4" />
    </span>
  );
}

function LockPill() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
      <Lock className="size-3" /> Always emailed
    </span>
  );
}

function AlwaysOnPill() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
      <Bell className="size-3" /> In-app: always on
    </span>
  );
}

/* --------------------------------------------------------- shared: Mute --- */

function MuteControl({
  store,
  size = "banner",
}: {
  store: Store;
  size?: "banner" | "hero";
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 rounded-xl border",
        store.muted ? "border-amber-400 bg-amber-50 dark:bg-amber-950/30" : "",
        size === "hero" ? "p-5" : "p-4"
      )}
    >
      <div className="flex items-center gap-3">
        <span
          className={cn(
            "grid size-9 place-items-center rounded-lg",
            store.muted
              ? "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300"
              : "bg-muted text-muted-foreground"
          )}
        >
          {store.muted ? (
            <BellOff className="size-4" />
          ) : (
            <Mail className="size-4" />
          )}
        </span>
        <div>
          <p className="font-medium">Mute all email</p>
          <p className="text-sm text-muted-foreground">
            {store.muted
              ? "All tunable emails are paused. Transactional refund emails still send."
              : "Pause every email at once. In-app and transactional refund emails are unaffected."}
          </p>
        </div>
      </div>
      <Toggle
        label="Mute all email"
        checked={store.muted}
        onChange={store.setMuted}
      />
    </div>
  );
}

/* ---------------------------------------------- shared: effective readout --- */

function EffectivePanel({ store, role }: { store: Store; role: Role }) {
  const [open, setOpen] = useState(false);
  const types = typesForRole(role);
  const courses = COURSES;
  return (
    <div className="rounded-xl border bg-muted/30">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium"
      >
        <span className="flex items-center gap-2 text-muted-foreground">
          <Info className="size-4" /> What gets emailed right now (resolved
          state)
        </span>
        <ChevronDown
          className={cn("size-4 transition-transform", open && "rotate-180")}
        />
      </button>
      {open && (
        <div className="space-y-3 border-t px-4 py-3 text-sm">
          {types.map((t) => {
            const m = TYPE_META[t];
            return (
              <div key={t}>
                <p className="font-medium">{m.label}</p>
                {m.transactional ? (
                  <p className="text-muted-foreground">
                    Email: <span className="text-emerald-600">on</span>{" "}
                    (transactional — always, Mute-exempt)
                  </p>
                ) : m.courseScoped ? (
                  <ul className="mt-1 space-y-0.5 text-muted-foreground">
                    {courses.map((c) => {
                      const on = store.effective(t, c.id);
                      const ov = store.courseOverride(t, c.id);
                      return (
                        <li key={c.id} className="tabular-nums">
                          {c.title}:{" "}
                          <span
                            className={
                              on ? "text-emerald-600" : "text-rose-600"
                            }
                          >
                            {on ? "on" : "off"}
                          </span>
                          {store.muted
                            ? " (muted)"
                            : ov !== undefined
                              ? " (per-course override)"
                              : " (inherits default)"}
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="text-muted-foreground">
                    Email:{" "}
                    <span
                      className={
                        store.effective(t) ? "text-emerald-600" : "text-rose-600"
                      }
                    >
                      {store.effective(t) ? "on" : "off"}
                    </span>
                    {store.muted ? " (muted)" : ""}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function EmptyRoleNote({ role }: { role: Role }) {
  return (
    <Card>
      <CardContent className="py-10 text-center text-sm text-muted-foreground">
        As a {role}, you don't receive any course-scoped notifications, so there
        are no per-course settings to show.
      </CardContent>
    </Card>
  );
}

/* ============================================================== VARIANT A === */
/* Type-first list. Per-course settings are nested under each course-scoped
   type via progressive disclosure. The per-type toggle is the primary
   affordance; course detail hides until asked for. */

function VariantA({ store, role }: { store: Store; role: Role }) {
  const types = typesForRole(role);
  return (
    <div className="space-y-6">
      <MuteControl store={store} />
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Email notifications</h2>
              <p className="text-sm text-muted-foreground">
                Choose what reaches your inbox.
              </p>
            </div>
            <AlwaysOnPill />
          </div>
        </CardHeader>
        <CardContent className="divide-y p-0">
          {types.map((t) => (
            <RowA key={t} store={store} type={t} />
          ))}
        </CardContent>
      </Card>
      <EffectivePanel store={store} role={role} />
    </div>
  );
}

function RowA({ store, type }: { store: Store; type: PrefType }) {
  const m = TYPE_META[type];
  const [expanded, setExpanded] = useState(false);
  const overriddenCount = m.courseScoped
    ? COURSES.filter((c) => store.courseOverride(type, c.id) !== undefined)
        .length
    : 0;
  return (
    <div className="px-5 py-4">
      <div className="flex items-start gap-3">
        <TypeIcon type={type} />
        <div className="min-w-0 flex-1">
          <p className="font-medium">{m.label}</p>
          <p className="text-sm text-muted-foreground">{m.description}</p>
          {m.courseScoped && (
            <button
              onClick={() => setExpanded((e) => !e)}
              className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-primary"
            >
              <ChevronRight
                className={cn(
                  "size-4 transition-transform",
                  expanded && "rotate-90"
                )}
              />
              Customize per course
              {overriddenCount > 0 && (
                <span className="rounded-full bg-primary/10 px-1.5 text-xs">
                  {overriddenCount} overridden
                </span>
              )}
            </button>
          )}
        </div>
        <div className="pt-0.5">
          {m.transactional ? (
            <LockPill />
          ) : (
            <Toggle
              label={`Email for ${m.label}`}
              checked={store.effective(type)}
              disabled={store.muted}
              onChange={(v) => store.setGlobal(type, v)}
            />
          )}
        </div>
      </div>
      {m.courseScoped && expanded && (
        <div className="mt-3 space-y-1 border-l-2 pl-4 ms-4">
          <p className="pb-1 text-xs uppercase tracking-wide text-muted-foreground">
            Per course — overrides the default above
          </p>
          {COURSES.map((c) => {
            const ov = store.courseOverride(type, c.id);
            const inheriting = ov === undefined;
            const value = store.effective(type, c.id);
            return (
              <div
                key={c.id}
                className="flex items-center justify-between py-1.5"
              >
                <span className="flex items-center gap-2 text-sm">
                  {c.title}
                  {inheriting && (
                    <span className="text-xs text-muted-foreground">
                      inherits default ({store.globalOf(type) ? "on" : "off"})
                    </span>
                  )}
                  {!inheriting && (
                    <button
                      onClick={() => store.setCourse(type, c.id, undefined)}
                      className="text-xs text-primary underline"
                    >
                      reset
                    </button>
                  )}
                </span>
                <Toggle
                  label={`Email for ${m.label} on ${c.title}`}
                  checked={value}
                  disabled={store.muted}
                  onChange={(v) => store.setCourse(type, c.id, v)}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ============================================================== VARIANT B === */
/* Matrix. Course-scoped types are rows; courses are columns, with a leading
   "All courses" column that sets the default. The whole per-course layer is
   visible at once — good for an instructor comparing across courses. */

function VariantB({ store, role }: { store: Store; role: Role }) {
  const types = typesForRole(role);
  const globalTypes = types.filter((t) => !TYPE_META[t].courseScoped);
  const courseTypes = types.filter((t) => TYPE_META[t].courseScoped);
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Email notifications</h2>
          <p className="text-sm text-muted-foreground">
            In-app is always on. This grid tunes email only.
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className={store.muted ? "font-medium text-amber-600" : ""}>
            Mute all email
          </span>
          <Toggle
            label="Mute all email"
            checked={store.muted}
            onChange={store.setMuted}
          />
        </div>
      </div>

      {globalTypes.length > 0 && (
        <Card>
          <CardContent className="divide-y p-0">
            {globalTypes.map((t) => {
              const m = TYPE_META[t];
              return (
                <div key={t} className="flex items-center gap-3 px-5 py-3">
                  <TypeIcon type={t} />
                  <div className="flex-1">
                    <p className="font-medium">{m.label}</p>
                    <p className="text-sm text-muted-foreground">
                      {m.description}
                    </p>
                  </div>
                  {m.transactional ? (
                    <LockPill />
                  ) : (
                    <Toggle
                      label={`Email for ${m.label}`}
                      checked={store.effective(t)}
                      disabled={store.muted}
                      onChange={(v) => store.setGlobal(t, v)}
                    />
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {courseTypes.length === 0 ? (
        role !== "Platform Admin" ? null : <EmptyRoleNote role={role} />
      ) : (
        <Card>
          <CardHeader>
            <h3 className="font-semibold">Per course</h3>
            <p className="text-sm text-muted-foreground">
              The <span className="font-medium">All courses</span> column is the
              default; set a cell to override one course.
            </p>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full border-separate border-spacing-0 text-sm">
              <thead>
                <tr className="text-left">
                  <th className="pb-3 pr-4 font-medium">Notification</th>
                  <th className="px-3 pb-3 text-center font-medium">
                    All courses
                    <div className="text-xs font-normal text-muted-foreground">
                      default
                    </div>
                  </th>
                  {COURSES.map((c) => (
                    <th
                      key={c.id}
                      className="px-3 pb-3 text-center font-medium"
                    >
                      {c.title}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {courseTypes.map((t) => {
                  const m = TYPE_META[t];
                  return (
                    <tr key={t} className="border-t">
                      <td className="py-3 pr-4">
                        <div className="flex items-center gap-2">
                          <TypeIcon type={t} />
                          <span className="font-medium">{m.label}</span>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-center">
                        <div className="inline-flex flex-col items-center gap-1">
                          <Toggle
                            label={`Default email for ${m.label}`}
                            checked={store.globalOf(t)}
                            disabled={store.muted}
                            onChange={(v) => store.setGlobal(t, v)}
                          />
                        </div>
                      </td>
                      {COURSES.map((c) => {
                        const ov = store.courseOverride(t, c.id);
                        const inheriting = ov === undefined;
                        return (
                          <td key={c.id} className="px-3 py-3 text-center">
                            <div className="inline-flex flex-col items-center gap-1">
                              <Toggle
                                label={`Email for ${m.label} on ${c.title}`}
                                checked={store.effective(t, c.id)}
                                disabled={store.muted}
                                onChange={(v) => store.setCourse(t, c.id, v)}
                              />
                              <span
                                className={cn(
                                  "text-[10px] uppercase tracking-wide",
                                  inheriting
                                    ? "text-muted-foreground/60"
                                    : "font-semibold text-primary"
                                )}
                              >
                                {inheriting ? "default" : "override"}
                              </span>
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
      <EffectivePanel store={store} role={role} />
    </div>
  );
}

/* ============================================================== VARIANT C === */
/* Course-first. Notifications are grouped by meaning: "Always sent"
   (transactional), a per-course accordion where you pick a course and tune its
   types, and a "Default for all courses" panel. Inverts B's axis — course is
   the primary context, type is secondary. */

function VariantC({ store, role }: { store: Store; role: Role }) {
  const types = typesForRole(role);
  const transactional = types.filter((t) => TYPE_META[t].transactional);
  const globalTunable = types.filter(
    (t) => !TYPE_META[t].transactional && !TYPE_META[t].courseScoped
  );
  const courseTypes = types.filter((t) => TYPE_META[t].courseScoped);
  const [openCourse, setOpenCourse] = useState<string | null>("__default__");

  return (
    <div className="space-y-6">
      <MuteControl store={store} size="hero" />

      {transactional.length > 0 && (
        <Card>
          <CardHeader>
            <h3 className="flex items-center gap-2 font-semibold">
              <Lock className="size-4 text-muted-foreground" /> Always sent
            </h3>
            <p className="text-sm text-muted-foreground">
              Money-related confirmations. These always email and ignore Mute —
              there's nothing to turn off.
            </p>
          </CardHeader>
          <CardContent className="divide-y p-0">
            {transactional.map((t) => {
              const m = TYPE_META[t];
              return (
                <div key={t} className="flex items-center gap-3 px-5 py-3">
                  <TypeIcon type={t} />
                  <div className="flex-1">
                    <p className="font-medium">{m.label}</p>
                    <p className="text-sm text-muted-foreground">
                      {m.description}
                    </p>
                  </div>
                  <LockPill />
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {globalTunable.length > 0 && (
        <Card>
          <CardHeader>
            <h3 className="font-semibold">General</h3>
          </CardHeader>
          <CardContent className="divide-y p-0">
            {globalTunable.map((t) => {
              const m = TYPE_META[t];
              return (
                <div key={t} className="flex items-center gap-3 px-5 py-3">
                  <TypeIcon type={t} />
                  <div className="flex-1">
                    <p className="font-medium">{m.label}</p>
                    <p className="text-sm text-muted-foreground">
                      {m.description}
                    </p>
                  </div>
                  <Toggle
                    label={`Email for ${m.label}`}
                    checked={store.effective(t)}
                    disabled={store.muted}
                    onChange={(v) => store.setGlobal(t, v)}
                  />
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {courseTypes.length > 0 && (
        <Card>
          <CardHeader>
            <h3 className="font-semibold">Your courses</h3>
            <p className="text-sm text-muted-foreground">
              Pick a course to tune its emails, or set the default for all
              courses.
            </p>
          </CardHeader>
          <CardContent className="p-0">
            <CoursePanel
              store={store}
              title="Default for all courses"
              subtitle="Applies unless a course below overrides it"
              courseId={null}
              courseTypes={courseTypes}
              open={openCourse === "__default__"}
              onToggle={() =>
                setOpenCourse((o) =>
                  o === "__default__" ? null : "__default__"
                )
              }
            />
            {COURSES.map((c) => (
              <CoursePanel
                key={c.id}
                store={store}
                title={c.title}
                courseId={c.id}
                courseTypes={courseTypes}
                open={openCourse === c.id}
                onToggle={() =>
                  setOpenCourse((o) => (o === c.id ? null : c.id))
                }
              />
            ))}
          </CardContent>
        </Card>
      )}

      {courseTypes.length === 0 &&
        globalTunable.length === 0 &&
        transactional.length === 0 && <EmptyRoleNote role={role} />}

      <EffectivePanel store={store} role={role} />
    </div>
  );
}

function CoursePanel({
  store,
  title,
  subtitle,
  courseId,
  courseTypes,
  open,
  onToggle,
}: {
  store: Store;
  title: string;
  subtitle?: string;
  courseId: string | null; // null = the default-for-all panel
  courseTypes: PrefType[];
  open: boolean;
  onToggle: () => void;
}) {
  const overrides =
    courseId === null
      ? 0
      : courseTypes.filter(
          (t) => store.courseOverride(t, courseId) !== undefined
        ).length;
  return (
    <div className="border-t first:border-t-0">
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between px-5 py-3.5 text-left"
      >
        <span>
          <span className="font-medium">{title}</span>
          {subtitle && (
            <span className="block text-xs text-muted-foreground">
              {subtitle}
            </span>
          )}
          {overrides > 0 && (
            <span className="block text-xs text-primary">
              {overrides} override{overrides > 1 ? "s" : ""}
            </span>
          )}
        </span>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180"
          )}
        />
      </button>
      {open && (
        <div className="space-y-1 bg-muted/30 px-5 pb-4 pt-1">
          {courseTypes.map((t) => {
            const m = TYPE_META[t];
            const inheriting =
              courseId !== null &&
              store.courseOverride(t, courseId) === undefined;
            const checked =
              courseId === null
                ? store.globalOf(t)
                : store.effective(t, courseId);
            return (
              <div
                key={t}
                className="flex items-center justify-between py-2"
              >
                <span className="flex items-center gap-2 text-sm">
                  <span className={cn("size-2 rounded-full", "bg-current", m.tint)} />
                  {m.label}
                  {inheriting && (
                    <span className="text-xs text-muted-foreground">
                      inherits default ({store.globalOf(t) ? "on" : "off"})
                    </span>
                  )}
                  {courseId !== null && !inheriting && (
                    <button
                      onClick={() => store.setCourse(t, courseId, undefined)}
                      className="text-xs text-primary underline"
                    >
                      reset
                    </button>
                  )}
                </span>
                <Toggle
                  label={`Email for ${m.label}${courseId ? "" : " (default)"}`}
                  checked={checked}
                  disabled={store.muted}
                  onChange={(v) =>
                    courseId === null
                      ? store.setGlobal(t, v)
                      : store.setCourse(t, courseId, v)
                  }
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ----------------------------------------------------------- the switcher --- */

const VARIANTS = [
  { key: "A", name: "Type-first list (per-course nested)" },
  { key: "B", name: "Matrix (types × courses)" },
  { key: "C", name: "Course-first (accordion)" },
] as const;

const ROLES: { key: string; role: Role }[] = [
  { key: "instructor", role: "Instructor" },
  { key: "student", role: "Student" },
  { key: "admin", role: "Platform Admin" },
];

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

function RolePreview({ current }: { current: string }) {
  const [params, setParams] = useSearchParams();
  function pick(key: string) {
    const p = new URLSearchParams(params);
    p.set("role", key);
    setParams(p, { replace: true });
  }
  return (
    <div className="inline-flex items-center gap-1 rounded-lg border bg-muted/40 p-1 text-sm">
      <span className="px-2 text-xs uppercase tracking-wide text-muted-foreground">
        Preview as
      </span>
      {ROLES.map((r) => (
        <button
          key={r.key}
          onClick={() => pick(r.key)}
          className={cn(
            "rounded-md px-2.5 py-1 font-medium",
            current === r.key
              ? "bg-background shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {r.role}
        </button>
      ))}
    </div>
  );
}

/* --------------------------------------------------------------- the page --- */

export default function PrototypeNotificationPreferences() {
  const [params] = useSearchParams();
  const variant = (params.get("variant") ?? "A").toUpperCase();
  const roleKey = params.get("role") ?? "instructor";
  const role = useMemo(
    () => ROLES.find((r) => r.key === roleKey)?.role ?? "Instructor",
    [roleKey]
  );
  const store = useStore();

  const body =
    variant === "B" ? (
      <VariantB store={store} role={role} />
    ) : variant === "C" ? (
      <VariantC store={store} role={role} />
    ) : (
      <VariantA store={store} role={role} />
    );

  return (
    <div className="min-h-screen bg-background pb-24 text-foreground">
      <div className="mx-auto max-w-3xl p-6 lg:p-8">
        <nav className="mb-6 text-sm text-muted-foreground">
          <span className="hover:text-foreground">Home</span>
          <span className="mx-2">/</span>
          <span className="hover:text-foreground">Settings</span>
          <span className="mx-2">/</span>
          <span className="text-foreground">Notifications</span>
        </nav>

        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">Notification settings</h1>
            <p className="mt-1 text-muted-foreground">
              Variant {variant}: {VARIANTS.find((v) => v.key === variant)?.name}.
              Use ← / → to switch. Role-filtered —{" "}
              <span className="font-medium text-foreground">{role}</span> view.
            </p>
          </div>
          <RolePreview current={roleKey} />
        </div>

        {body}
      </div>
      <PrototypeSwitcher current={variant} />
    </div>
  );
}
