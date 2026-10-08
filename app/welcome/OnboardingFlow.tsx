"use client";

import { useUser } from "@clerk/nextjs";
import Link from "next/link";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { TopicIcon } from "@/app/FeedTopics";
import { CameraIcon, CommentIcon, OmensIcon, TrendIcon, TrophyIcon } from "@/app/icons";
import { avatarGradient } from "@/app/lib/avatar";
import {
  EXPERIENCE,
  GOALS,
  PACES,
  REFERRALS,
  firstMovesFor,
  type ExperienceId,
  type GoalId,
  type PaceId,
  type ReferralId,
} from "@/app/lib/onboardingQuestions";
import { replaceInterests } from "@/app/lib/postLists";
import { AVATAR_MAX_BYTES, IMAGE_ACCEPT, PROFILE_LIMITS, handleProblem, normalizeHandle } from "@/app/lib/profileEdit";
import { TOPIC_KINDS, TOPICS, type TopicId } from "@/app/lib/topics";
import { checkHandle, saveProfileBasics, type ProfileField } from "@/app/profile/actions";
import { finishOnboarding } from "./actions";

// /welcome: profile → why you're here → experience → interests → finish,
// then a finish screen that points at a first move picked from the answers
// (firstMovesFor). The profile step saves on Continue (saveProfileBasics; the
// photo goes to Clerk after), so leaving midway still leaves a usable
// profile. The survey answers are held here and saved once, by
// finishOnboarding; picked topics also become this browser's Omens interests.

export type WelcomeProfile = {
  displayName: string;
  handle: string;
  bio: string;
  // Null when the Clerk account has no uploaded photo.
  avatarUrl: string | null;
  avatarSeed: string;
};

const STEPS = [
  {
    id: "profile",
    title: "Set up your profile",
    sub: "This is how other traders see you in the feed and the Arena.",
  },
  {
    id: "goals",
    title: "What brings you to Prophecy?",
    sub: "Pick all that apply.",
  },
  {
    id: "experience",
    title: "How experienced are you?",
    sub: "No wrong answers. This just shapes where we start you.",
  },
  {
    id: "interests",
    title: "What do you want to follow?",
    sub: "Your picks shape the Omens feed. Change them anytime.",
  },
  {
    id: "finish",
    title: "One last thing",
    sub: "Then you're in.",
  },
] as const;

const GOAL_ICONS: Record<GoalId, (props: { className?: string }) => React.JSX.Element> = {
  learn: OmensIcon,
  community: CommentIcon,
  strategies: TrendIcon,
  profit: TrophyIcon,
};

type AvatarDraft = { kind: "keep" } | { kind: "remove" } | { kind: "new"; file: File; previewUrl: string };
type FormError = { message: string; field?: ProfileField | "avatar" };
type HandleCheck = { handle: string; error: string | null };

const toggled = <T,>(list: T[], id: T) => (list.includes(id) ? list.filter((other) => other !== id) : [...list, id]);

export function OnboardingFlow({ profile }: { profile: WelcomeProfile }) {
  const id = useId();
  const { user } = useUser();
  const [step, setStep] = useState(0);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<FormError | null>(null);
  const [pending, startTransition] = useTransition();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);

  // Profile step.
  const [fields, setFields] = useState({ displayName: profile.displayName, handle: profile.handle, bio: profile.bio });
  const [avatarUrl, setAvatarUrl] = useState(profile.avatarUrl);
  const [avatar, setAvatar] = useState<AvatarDraft>({ kind: "keep" });
  const [handleCheck, setHandleCheck] = useState<HandleCheck | null>(null);
  const avatarInput = useRef<HTMLInputElement>(null);
  const objectUrls = useRef<string[]>([]);

  // Survey.
  const [goals, setGoals] = useState<GoalId[]>([]);
  const [experience, setExperience] = useState<ExperienceId | null>(null);
  const [paces, setPaces] = useState<PaceId[]>([]);
  const [interests, setInterests] = useState<TopicId[]>([]);
  const [referral, setReferral] = useState<ReferralId | null>(null);
  const [adult, setAdult] = useState(false);

  useEffect(() => {
    const urls = objectUrls.current;
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  // Each new step starts at the top with its heading focused, so screen
  // readers announce it. Not on first load — the page just opened.
  useEffect(() => {
    if (!moved.current) {
      moved.current = true;
      return;
    }
    window.scrollTo(0, 0);
    headingRef.current?.focus();
  }, [step, done]);

  const handle = normalizeHandle(fields.handle);
  const handleIssue = handle ? handleProblem(handle) : null;

  // Availability hint, debounced. The save re-checks, so a stale or failed
  // check never blocks anything — it only reports.
  useEffect(() => {
    if (!handle || handleIssue) return;
    let live = true;
    const timer = setTimeout(() => {
      checkHandle(handle)
        .then((result) => live && setHandleCheck({ handle, error: result.ok ? null : result.error }))
        .catch(() => {});
    }, 350);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [handle, handleIssue]);

  const checked = handleCheck?.handle === handle ? handleCheck : null;
  const fieldError = (field: NonNullable<FormError["field"]>) => (error?.field === field ? error.message : null);
  const handleError = fieldError("handle") ?? handleIssue ?? checked?.error ?? null;
  const shownAvatar = avatar.kind === "new" ? avatar.previewUrl : avatar.kind === "remove" ? null : avatarUrl;
  const initial = (fields.displayName.trim() || handle || "?").charAt(0).toUpperCase();

  const setField = (key: keyof typeof fields) => (event: { target: { value: string } }) => {
    setFields((current) => ({ ...current, [key]: event.target.value }));
    if (error?.field === key) setError(null);
  };

  function pickAvatar(file: File | undefined) {
    if (!file) return;
    if (!IMAGE_ACCEPT.split(",").includes(file.type) || file.size > AVATAR_MAX_BYTES) {
      setError({ field: "avatar", message: "Photo must be a JPEG, PNG or WebP under 10 MB." });
      return;
    }
    const previewUrl = URL.createObjectURL(file);
    objectUrls.current.push(previewUrl);
    setAvatar({ kind: "new", file, previewUrl });
    setError(null);
  }

  function go(next: number) {
    setError(null);
    setStep(next);
  }

  function saveProfileStep() {
    startTransition(async () => {
      setError(null);
      const formData = new FormData();
      for (const [key, value] of Object.entries(fields)) formData.set(key, value);
      try {
        const result = await saveProfileBasics(formData);
        if (!result.ok) return setError({ message: result.error, field: result.field });
      } catch {
        return setError({ message: "Couldn't save your profile — try again." });
      }

      if (avatar.kind !== "keep") {
        const draft = avatar;
        // Either way the draft is spent: a retry of Continue shouldn't re-upload.
        setAvatar({ kind: "keep" });
        try {
          if (!user) throw new Error("Clerk user not loaded");
          await user.setProfileImage({ file: draft.kind === "new" ? draft.file : null });
          setAvatarUrl(draft.kind === "new" ? draft.previewUrl : null);
        } catch {
          return setError({ field: "avatar", message: "Profile saved, but the photo didn't upload. Try another image, or continue without one." });
        }
      }
      go(1);
    });
  }

  function finish() {
    startTransition(async () => {
      setError(null);
      let timezone: string | null = null;
      try {
        timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || null;
      } catch {
        // Older browsers: just don't record one.
      }
      try {
        const result = await finishOnboarding({ goals, experience: experience ?? "", paces, interests, referral, timezone, adult });
        if (!result.ok) return setError({ message: result.error });
      } catch {
        return setError({ message: "Couldn't finish setting up — try again." });
      }
      // No picks keeps the feed's defaults rather than an empty For You.
      if (interests.length > 0) replaceInterests(interests);
      setDone(true);
    });
  }

  if (done) {
    const [lead, ...rest] = firstMovesFor({ goals, experience: experience ?? "new", paces });
    // The name they just chose; email sign-ups have no Clerk first name.
    const firstName = fields.displayName.trim().split(/\s+/)[0];
    return (
      <section className="welcome-card welcome-done" aria-labelledby={`${id}-done`}>
        <span className="welcome-done-sigil" aria-hidden="true">
          ✦
        </span>
        <h1 id={`${id}-done`} ref={headingRef} tabIndex={-1} className="display-font">
          You&apos;re in{firstName ? `, ${firstName}` : ""}.
        </h1>
        <p className="muted">Your profile is live{interests.length > 0 ? " and your feed is tuned" : ""}. Here&apos;s a good first move:</p>
        <Link href={lead.href} className="welcome-move welcome-move--lead">
          <span>
            <strong>{lead.title}</strong>
            <span>{lead.blurb}</span>
          </span>
          <span className="welcome-move-arrow" aria-hidden="true">
            →
          </span>
        </Link>
        <div className="welcome-moves">
          {rest.map((move) => (
            <Link key={move.id} href={move.href} className="welcome-move">
              <span>
                <strong>{move.title}</strong>
                <span className="muted">{move.blurb}</span>
              </span>
            </Link>
          ))}
        </div>
        <Link href="/profile" className="profile-empty-link welcome-done-profile">
          View your profile →
        </Link>
      </section>
    );
  }

  const current = STEPS[step];
  const last = step === STEPS.length - 1;
  const canContinue =
    current.id === "profile" ? Boolean(fields.displayName.trim() && handle && !handleIssue && !checked?.error)
    : current.id === "goals" ? goals.length > 0
    : current.id === "experience" ? experience !== null
    : current.id === "finish" ? adult
    : true;
  const continueLabel =
    pending ? "Saving…"
    : last ? "Enter Prophecy"
    : current.id === "interests" && interests.length === 0 ? "Skip for now"
    : "Continue";

  return (
    <section className="welcome-card" aria-labelledby={`${id}-title`}>
      <div className="welcome-progress">
        <ol aria-label="Setup steps">
          {STEPS.map((item, index) => (
            <li key={item.id} data-state={index < step ? "done" : index === step ? "current" : "todo"} aria-current={index === step ? "step" : undefined}>
              <span className="sr-only">{item.title}</span>
            </li>
          ))}
        </ol>
        <span className="muted">
          Step {step + 1} of {STEPS.length}
        </span>
      </div>

      <form
        className="welcome-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!canContinue || pending) return;
          if (current.id === "profile") saveProfileStep();
          else if (last) finish();
          else go(step + 1);
        }}
      >
        <div key={current.id} className="welcome-step">
          <header className="welcome-head">
            {step === 0 && <p className="welcome-eyebrow">Welcome to Prophecy</p>}
            <h1 id={`${id}-title`} ref={headingRef} tabIndex={-1} className="display-font">
              {current.title}
            </h1>
            <p className="muted">{current.sub}</p>
          </header>

          {current.id === "profile" && (
            <div className="welcome-profile">
              <div className="welcome-avatar-row">
                <button
                  type="button"
                  className="profile-edit-avatar welcome-avatar"
                  aria-label={shownAvatar ? "Change photo" : "Add a photo"}
                  style={{ background: avatarGradient(profile.avatarSeed) }}
                  onClick={() => avatarInput.current?.click()}
                >
                  {shownAvatar ? <img src={shownAvatar} alt="" /> : initial}
                  <span className="profile-edit-avatar-overlay" aria-hidden="true">
                    <CameraIcon />
                  </span>
                </button>
                <div className="welcome-avatar-text">
                  <strong>Profile photo</strong>
                  <span className="muted">Optional. JPEG, PNG or WebP.</span>
                  <span className="welcome-avatar-actions">
                    <button type="button" className="profile-edit-text-button" onClick={() => avatarInput.current?.click()}>
                      {shownAvatar ? "Change" : "Upload"}
                    </button>
                    {shownAvatar && (
                      <button type="button" className="profile-edit-text-button" onClick={() => setAvatar({ kind: "remove" })}>
                        Remove
                      </button>
                    )}
                  </span>
                </div>
                {/* Value cleared after each pick so choosing the same file again still fires. */}
                <input
                  ref={avatarInput}
                  type="file"
                  accept={IMAGE_ACCEPT}
                  hidden
                  onChange={(event) => {
                    pickAvatar(event.target.files?.[0]);
                    event.target.value = "";
                  }}
                />
              </div>
              {fieldError("avatar") && (
                <p className="profile-edit-error" role="alert">
                  {fieldError("avatar")}
                </p>
              )}

              <div className="profile-edit-grid">
                <Field id={`${id}-name`} label="Name" count={fields.displayName.length} limit={PROFILE_LIMITS.displayName} error={fieldError("displayName")}>
                  <input
                    id={`${id}-name`}
                    value={fields.displayName}
                    maxLength={PROFILE_LIMITS.displayName}
                    autoComplete="nickname"
                    required
                    onChange={setField("displayName")}
                  />
                </Field>
                <Field
                  id={`${id}-handle`}
                  label="Handle"
                  error={handleError}
                  hint={!handle ? "Letters, numbers, _ and ." : checked ? `@${handle} is yours` : "Checking…"}
                  ok={Boolean(checked && !checked.error)}
                >
                  <span className="profile-edit-prefixed">
                    <span aria-hidden="true">@</span>
                    <input
                      id={`${id}-handle`}
                      value={fields.handle}
                      maxLength={PROFILE_LIMITS.handle + 1}
                      autoCapitalize="none"
                      autoComplete="username"
                      spellCheck={false}
                      required
                      onChange={setField("handle")}
                    />
                  </span>
                </Field>
                <Field id={`${id}-bio`} label="Bio" optional wide count={fields.bio.length} limit={PROFILE_LIMITS.bio} error={fieldError("bio")}>
                  <textarea
                    id={`${id}-bio`}
                    value={fields.bio}
                    rows={3}
                    maxLength={PROFILE_LIMITS.bio}
                    placeholder="What do you trade, and how? e.g. BTC maxi, fading every pump since 2017."
                    onChange={setField("bio")}
                  />
                </Field>
              </div>
              <p className="welcome-note muted">Banner, location and website can wait. Add them anytime from your profile.</p>
            </div>
          )}

          {current.id === "goals" && (
            <div className="welcome-options welcome-options--grid" role="group" aria-labelledby={`${id}-title`}>
              {GOALS.map((goal) => {
                const Icon = GOAL_ICONS[goal.id];
                return (
                  <label key={goal.id} className="welcome-option">
                    <input type="checkbox" className="sr-only" checked={goals.includes(goal.id)} onChange={() => setGoals((list) => toggled(list, goal.id))} />
                    <span className="welcome-option-icon" aria-hidden="true">
                      <Icon />
                    </span>
                    <span className="welcome-option-text">
                      <strong>{goal.title}</strong>
                      <span className="muted">{goal.blurb}</span>
                    </span>
                    <span className="welcome-option-check" aria-hidden="true" />
                  </label>
                );
              })}
            </div>
          )}

          {current.id === "experience" && (
            <>
              <div className="welcome-options" role="radiogroup" aria-labelledby={`${id}-title`}>
                {EXPERIENCE.map((level) => (
                  <label key={level.id} className="welcome-option">
                    <input
                      type="radio"
                      name={`${id}-experience`}
                      className="sr-only"
                      checked={experience === level.id}
                      onChange={() => setExperience(level.id)}
                    />
                    <span className="welcome-meter" data-level={level.level} aria-hidden="true">
                      <i />
                      <i />
                      <i />
                    </span>
                    <span className="welcome-option-text">
                      <strong>{level.title}</strong>
                      <span className="muted">{level.blurb}</span>
                    </span>
                    <span className="welcome-option-check is-radio" aria-hidden="true" />
                  </label>
                ))}
              </div>
              <fieldset className="welcome-subquestion">
                <legend>
                  How do you like to trade? <span className="muted">Optional · pick any</span>
                </legend>
                <div className="welcome-chips">
                  {PACES.map((pace) => (
                    <label key={pace.id} className="welcome-chip">
                      <input type="checkbox" className="sr-only" checked={paces.includes(pace.id)} onChange={() => setPaces((list) => toggled(list, pace.id))} />
                      <strong>{pace.title}</strong>
                      <span className="muted">{pace.blurb}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </>
          )}

          {current.id === "interests" && (
            <div className="welcome-interests">
              <p className="welcome-count muted" aria-live="polite">
                {interests.length === 0 ? "Pick a few. Three or more keeps For You lively." : `${interests.length} picked`}
              </p>
              {TOPIC_KINDS.map(({ kind, label }) => (
                <div key={kind} className="interest-group">
                  <p className="interest-group-label">{label}</p>
                  <div className="interest-options">
                    {TOPICS.filter((topic) => topic.kind === kind).map((topic) => {
                      const on = interests.includes(topic.id);
                      return (
                        <button
                          key={topic.id}
                          type="button"
                          className="interest-option"
                          aria-pressed={on}
                          onClick={() => setInterests((list) => toggled(list, topic.id))}
                        >
                          <TopicIcon topic={topic} />
                          {topic.label}
                          <span className="interest-option-mark" aria-hidden="true">
                            {on ? "✓" : "+"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {current.id === "finish" && (
            <div className="welcome-finish">
              <fieldset className="welcome-subquestion">
                <legend>
                  How did you hear about Prophecy? <span className="muted">Optional</span>
                </legend>
                <div className="interest-options">
                  {REFERRALS.map((source) => (
                    <button
                      key={source.id}
                      type="button"
                      className="interest-option"
                      aria-pressed={referral === source.id}
                      onClick={() => setReferral((value) => (value === source.id ? null : source.id))}
                    >
                      {source.title}
                    </button>
                  ))}
                </div>
              </fieldset>
              <label className="welcome-consent">
                <input type="checkbox" checked={adult} onChange={(event) => setAdult(event.target.checked)} />
                <span>
                  <strong>I&apos;m 18 or older</strong>
                  <span className="muted">Prophecy is built around wagering on market calls, so it&apos;s adults only.</span>
                </span>
              </label>
            </div>
          )}
        </div>

        {error && !error.field && (
          <p className="profile-edit-error welcome-error" role="alert">
            {error.message}
          </p>
        )}

        <footer className="welcome-foot">
          {step > 0 && (
            <button type="button" className="profile-follow is-following" disabled={pending} onClick={() => go(step - 1)}>
              Back
            </button>
          )}
          <button type="submit" className="profile-follow welcome-continue" disabled={pending || !canContinue}>
            {continueLabel}
          </button>
        </footer>
      </form>
    </section>
  );
}

// Same field shell as the Edit profile dialog (.profile-edit-field), plus
// "Optional" and a green hint once the handle check passes.
function Field({
  id,
  label,
  children,
  error,
  hint,
  ok,
  count,
  limit,
  optional,
  wide,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
  error?: string | null;
  hint?: string;
  ok?: boolean;
  count?: number;
  limit?: number;
  optional?: boolean;
  wide?: boolean;
}) {
  return (
    <div className={`profile-edit-field${wide ? " is-wide" : ""}${error ? " has-error" : ""}`}>
      <div className="profile-edit-label">
        <label htmlFor={id}>
          {label}
          {optional && <span className="muted"> · Optional</span>}
        </label>
        {limit !== undefined && (
          <span className="muted">
            {count}/{limit}
          </span>
        )}
      </div>
      {children}
      {(error ?? hint) && (
        <p className={error ? "profile-edit-error" : `profile-edit-hint${ok ? " welcome-hint-ok" : " muted"}`} aria-live="polite">
          {error ?? hint}
        </p>
      )}
    </div>
  );
}
