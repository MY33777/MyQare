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
  /**
   * Street, postcode and city. Required by art. 35a Wet OB and enforced by
   * missingFacilityFields() — an invoice cannot be created without them, and
   * nothing on any screen said so while the checklist reported everything done.
   */
  hasBillingAddress: boolean;
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
          : state.verified
            ? "Voeg de zzp'ers toe waar je nu al mee werkt. Zij krijgen je diensten als eerste te zien."
            : "Zodra je account is geverifieerd kun je hier de zzp'ers toevoegen waar je al mee werkt.",
      href: "/zorginstelling/pool",
      cta: "Pool opbouwen",
      done: state.poolCount > 0,
      /*
       * The one that actually matters. An empty pool does not stop a shift being
       * posted; it stops anyone hearing about it, and the app reports success
       * either way. That silent failure is the reason this checklist exists.
       */
      blocking: state.poolCount === 0,
      /*
       * WAITING, until verification lands.
       *
       * addToPoolAction refuses while the organisation is unverified, and so does
       * the policy behind it — pool membership grants a facility read access to a
       * stranger's approved VOG and diploma without her being asked, so that gate
       * is deliberate and stays.
       *
       * This step did not know about it. nextStep() picks the first BLOCKING step
       * that is not waiting, so a brand-new facility was told "Begin bij
       * zorgprofessionals in je pool", followed the link, typed the address of
       * somebody she has worked with for two years, and was refused — by a message
       * telling her to go and build her pool. Told to do a thing, refused, told
       * again. That is the moment she rings an agency instead.
       */
      waiting: !state.verified,
    },
    {
      key: "billing",
      title: "Factuurgegevens compleet",
      body:
        state.hasBillingEmail && state.hasBillingAddress
          ? "Facturen gaan naar je administratie."
          : !state.hasBillingAddress
            ? "Vul het adres van je organisatie in. Zonder straat, postcode en plaats kan er geen geldige factuur worden opgemaakt — goedgekeurd werk blijft dan onbetaald staan."
            : "Zonder factuur-e-mailadres kunnen we facturen niet bij je administratie afleveren. Meestal een gedeelde crediteuren-mailbox, niet een persoonlijk adres.",
      href: "/zorginstelling/instellingen",
      cta: "Gegevens invullen",
      done: state.hasBillingEmail && state.hasBillingAddress,
      /*
       * BLOCKING, and it was not.
       *
       * A missing address does not stop a shift being posted — it stops every
       * invoice against this facility from ever being created, which surfaces
       * weeks later as "de factuur kon niet worden opgemaakt, neem contact met
       * ons op" after hours have already been approved and a fee already charged.
       * That is the same silent-failure shape the pool step exists for.
       */
      blocking: !state.hasBillingAddress,
    },
    {
      key: "shift",
      title: "Eerste dienst geplaatst",
      body:
        state.shiftCount > 0
          ? `${state.shiftCount} ${state.shiftCount === 1 ? "dienst" : "diensten"} geplaatst.`
          : state.verified
            ? "Plaats een dienst. Wie ervoor in aanmerking komt krijgt direct een melding en kan aannemen — of weigeren."
            : "Zodra je account is geverifieerd kun je je eerste dienst plaatsen.",
      href: "/zorginstelling/diensten/nieuw",
      cta: "Dienst plaatsen",
      done: state.shiftCount > 0,
      blocking: false,
      // Same gate, same reason. /diensten/nieuw redirects straight back to the
      // dashboard while unverified, so pointing at it is a loop of one screen.
      waiting: !state.verified,
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
