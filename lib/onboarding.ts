/*
 * What a facility still has to do before the product works for them.
 *
 * A new facility lands on an empty dashboard with four different things it could
 * do and no indication which one is blocking. The most common failure is not that
 * they cannot work the software — it is posting a shift into an empty pool, which
 * succeeds, reaches nobody, and looks like a quiet market rather than a missing
 * step.
 *
 * Ordered by what actually blocks what, not by how hard each step is.
 */

export type ChecklistStep = {
  key: string;
  title: string;
  body: string;
  href: string;
  cta: string;
  done: boolean;
  /** True when nothing else can progress until this is resolved. */
  blocking: boolean;
  /** Waiting on us rather than on them — shown, but not as a task. */
  waiting?: boolean;
};

export type FacilityState = {
  verified: boolean;
  hasBillingEmail: boolean;
  poolCount: number;
  shiftCount: number;
  assignmentCount: number;
};

export function facilityChecklist(state: FacilityState): ChecklistStep[] {
  return [
    {
      key: "verified",
      title: "Account geverifieerd",
      body: state.verified
        ? "Je KvK-inschrijving is gecontroleerd."
        : "We controleren je KvK-inschrijving. Dit duurt meestal één werkdag — je hoeft niets te doen.",
      href: "/zorginstelling/instellingen",
      cta: "Gegevens bekijken",
      done: state.verified,
      // Blocking, but not actionable by them: posting is closed until a human here
      // has looked. Marked as waiting so it does not read as a task they forgot.
      blocking: !state.verified,
      waiting: !state.verified,
    },
    {
      key: "pool",
      title: "Zorgprofessionals in je pool",
      body:
        state.poolCount > 0
          ? `${state.poolCount} ${state.poolCount === 1 ? "zorgprofessional" : "zorgprofessionals"} in je pool.`
          : "Voeg de zzp'ers toe waar je nu al mee werkt. Zonder pool wordt een dienst aan niemand aangeboden — die komt dan stil te staan.",
      href: "/zorginstelling/pool",
      cta: "Pool opbouwen",
      done: state.poolCount > 0,
      /*
       * The one that actually matters. An empty pool does not stop a shift being
       * posted; it stops anyone hearing about it, and the app reports success
       * either way. That silent failure is the reason this checklist exists.
       */
      blocking: state.poolCount === 0,
    },
    {
      key: "billing",
      title: "Factuuradres ingesteld",
      body: state.hasBillingEmail
        ? "Facturen gaan naar je administratie."
        : "Zonder factuur-e-mailadres kunnen we facturen niet bij je administratie afleveren. Meestal een gedeelde crediteuren-mailbox, niet een persoonlijk adres.",
      href: "/zorginstelling/instellingen",
      cta: "Adres instellen",
      done: state.hasBillingEmail,
      blocking: false,
    },
    {
      key: "shift",
      title: "Eerste dienst geplaatst",
      body:
        state.shiftCount > 0
          ? `${state.shiftCount} ${state.shiftCount === 1 ? "dienst" : "diensten"} geplaatst.`
          : "Plaats een dienst. De zorgprofessionals in je pool krijgen direct een melding en kunnen aannemen — of weigeren.",
      href: "/zorginstelling/diensten/nieuw",
      cta: "Dienst plaatsen",
      done: state.shiftCount > 0,
      blocking: false,
    },
  ];
}

/** Whether the checklist is worth showing at all. */
export function checklistComplete(steps: ChecklistStep[]): boolean {
  return steps.every((step) => step.done);
}

/**
 * The one step to lead with.
 *
 * Blocking steps first, and among those the ones they can actually act on — being
 * told "waiting on us" is information, not a next action.
 */
export function nextStep(steps: ChecklistStep[]): ChecklistStep | null {
  const actionable = steps.filter((step) => !step.done && !step.waiting);
  return (
    actionable.find((step) => step.blocking) ??
    actionable[0] ??
    steps.find((step) => !step.done) ??
    null
  );
}
