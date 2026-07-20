import { BRAND } from '@/config/brand';
/**
 * The dispatchable Wave 5 welcome-journey copy. This module deliberately holds
 * copy and data only: it can be sealed with an intake checklist and shared by
 * the advisor UI and the self-contained client page.
 */
export type JourneyOwner = 'client' | 'firm' | 'advisor' | 'staff' | 'custodian' | 'signing provider' | 'outside signature path';

export interface WelcomeJourneyMilestone {
  id: string;
  label: string;
  description: string;
  owner: JourneyOwner;
  visible: boolean;
}

export interface WelcomeJourneyPerson {
  id: string;
  name?: string;
  role: string;
  photo_url?: string;
  initials?: string;
  ask_about: string;
  contact?: string;
}

export interface WelcomeJourney {
  welcome: { headline: string; intro: string; return_note: string; primary_action: string; next_step_heading: string; timeline_heading: string; team_heading: string; team_intro: string; help_heading: string };
  active_checklist: { progress_heading: string; timeline_label: string; save_action: string; skip_action: string; unknown_action: string; unknown_help: string; phone_provided_label: string };
  resume: Record<'not_started' | 'in_progress' | 'reviewing' | 'paperwork' | 'signature_ready' | 'active_client' | 'expired' | 'revoked' | 'completed_old_link', { heading: string; body: string }>;
  completion: { heading: string; body: string; section_heading: string; nothing_needed: string; pending_paperwork: string; pending_signature: string; ready_to_sign: string; sign_action: string };
  privacy: { heading: string; body: string[]; footer: string };
  handoff: { heading: string; body: string };
  phone_walkthrough_label: string;
  timeline: WelcomeJourneyMilestone[];
  people: WelcomeJourneyPerson[];
  help_contact_label: string;
}

export interface WelcomeJourneyEmailTemplate { id: string; subject: string; body: string }

export const DEFAULT_WELCOME_JOURNEY: WelcomeJourney = {
  welcome: {
    headline: 'Welcome, [client_first_name].',
    intro: 'This is your secure onboarding page with [firm_name]. We use it to collect the few things we need, show where you are in the process, and keep you clear on what happens next.',
    return_note: 'Start with the first item below. You can come back to this page with the same link.',
    primary_action: 'Continue secure checklist',
    next_step_heading: 'Your next step',
    timeline_heading: 'Where you are',
    team_heading: 'Your team',
    team_intro: 'These are the people who may help with your onboarding.',
    help_heading: 'Need help?',
  },
  active_checklist: {
    progress_heading: "You're partway there.", timeline_label: 'What happens next', save_action: 'Save and continue', skip_action: 'Skip for now', unknown_action: "I don't know yet", unknown_help: "That's okay. We'll help with this one.", phone_provided_label: 'Provided by phone with [support_first_name]',
  },
  resume: {
    not_started: { heading: 'Welcome back, [client_first_name].', body: 'Your secure onboarding page is ready. Start with the first item below.' },
    in_progress: { heading: 'Welcome back, [client_first_name].', body: "You're partway there. The next item is ready below." },
    reviewing: { heading: "We're reviewing what you shared.", body: 'You do not need to do anything right now. [support_first_name] will reach out if anything is missing.' },
    paperwork: { heading: "We're preparing the next paperwork step.", body: 'You do not need to do anything right now. Your next step will appear here when it is ready.' },
    signature_ready: { heading: 'Your next step is ready.', body: 'Please review the instructions below. If anything looks confusing, [help_contact_label].' },
    active_client: { heading: "You're all set for this part of onboarding.", body: 'Your secure page will stay available so you can check where things stand.' },
    expired: { heading: 'This link has expired.', body: '[firm_name] can send you a fresh link.' },
    revoked: { heading: 'This link is no longer active.', body: 'Please contact [firm_name] if you need help.' },
    completed_old_link: { heading: 'This onboarding step is complete.', body: 'Please contact [firm_name] if you need to send something else.' },
  },
  completion: {
    heading: "Thanks, [client_first_name]. You've sent the information we need to start.", body: 'Our team is reviewing it now. If we need anything else, [support_first_name] will reach out.\n\nYou can return to this page to see where things stand.', section_heading: 'What happens next', nothing_needed: 'Nothing needed from you right now.', pending_paperwork: "We're preparing [paperwork_label].", pending_signature: 'Your signature or transfer step will appear here when it is ready.', ready_to_sign: 'Your paperwork is ready for review and signature.', sign_action: 'Review and sign',
  },
  privacy: {
    heading: 'How this page protects your information',
    body: ['This page encrypts your answers and uploads on your device before they are sent.', 'Only [firm_name] can unlock what you send.', 'For sensitive items, this page shows a checkmark after you provide them. It does not show the answer or file again.', 'If you prefer not to enter something here, [help_contact_label].'],
    footer: `Powered by ${BRAND.name} for [firm_name].`,
  },
  handoff: { heading: 'Your team has been updated.', body: '[new_team_member_full_name] can help with uploads, signatures, and scheduling.' },
  phone_walkthrough_label: '[support_first_name] helped complete this by phone.',
  timeline: [
    { id: 'welcome', label: 'Welcome', description: 'Your secure onboarding page is ready.', owner: 'firm', visible: true },
    { id: 'information_needed', label: 'Information needed', description: 'Answer the checklist items and upload the requested documents.', owner: 'client', visible: true },
    { id: 'reviewing', label: 'Reviewing', description: 'Our team checks what you shared.', owner: 'firm', visible: true },
    { id: 'paperwork', label: 'Paperwork', description: 'We prepare forms, transfers, or signatures.', owner: 'firm', visible: true },
    { id: 'signature_or_transfer', label: 'Signature or transfer', description: 'You review or confirm the next paperwork step.', owner: 'signing provider', visible: true },
    { id: 'active_client', label: 'Active client', description: 'Onboarding is complete and your client record is ready for planning work.', owner: 'firm', visible: true },
  ],
  people: [
    { id: 'lead_advisor', role: 'Lead advisor', ask_about: 'Ask [advisor_first_name] about your planning questions and advice.' },
    { id: 'client_service_associate', role: 'Client service associate', ask_about: 'Ask [support_first_name] about uploads, signatures, and scheduling.' },
    { id: 'operations_specialist', role: 'Operations specialist', ask_about: 'Ask our operations team about account paperwork and transfers.' },
    { id: 'planning_analyst', role: 'Planning analyst', ask_about: 'Ask our planning team about information we are reviewing for your plan.' },
  ],
  help_contact_label: 'reply to this email',
};

const WELCOME_JOURNEY_EMAIL_ROWS: Array<[string, string, string]> = [
  ['welcome', 'Welcome to [firm_name]', "Hi [client_first_name],\n\nWe're glad you're here.\n\nYour secure onboarding page is ready:\n[secure_link]\n\nInside, you'll see what we need from you, what happens after each step, and who to contact if anything feels confusing.\n\nFirst step: [primary_next_item].\n\nThanks,\n[advisor_first_name]"],
  ['opened_not_started', 'Need help getting started?', "Hi [client_first_name],\n\nYour onboarding page is ready when you are.\n\nThe first step is [primary_next_item]. If you'd rather walk through it together, reply here and [support_first_name] can help.\n\nThanks,\n[advisor_first_name]"],
  ['first_item_received', 'We received your first item', "Hi [client_first_name],\n\nThank you. We received your first onboarding item.\n\nNext, please continue with the checklist when you are ready:\n[secure_link]\n\nIf anything feels confusing, reply here and [support_first_name] can help.\n\nThanks,\n[advisor_first_name]"],
  ['document_received', 'We received your document', "Hi [client_first_name],\n\nThank you. We received the document you sent.\n\nThe next item is ready on your secure page:\n[secure_link]\n\nThanks,\n[advisor_first_name]"],
  ['gentle_reminder', 'A few onboarding items for [firm_name]', "Hi [client_first_name],\n\nI wanted to keep this easy to find.\n\nThere are a few items left on your onboarding checklist:\n[missing_items_sentence]\n\nSame secure page:\n[secure_link]\n\nA rough answer is fine where the page says so. If you'd rather walk through it together, reply here and [support_first_name] can help.\n\nThanks,\n[advisor_first_name]"],
  ['ready_for_review', 'We have what we need for review', "Hi [client_first_name],\n\nThank you for sending your information. Our team is reviewing it now.\n\nIf we spot anything missing, [support_first_name] will reach out with a short list. If everything looks ready, we'll prepare the next paperwork step.\n\nThanks,\n[advisor_first_name]"],
  ['needs_another_look', 'One onboarding item needs another look', "Hi [client_first_name],\n\nThank you for sending your information.\n\nOne item needs another look:\n[missing_items_sentence]\n\nYou can update it here:\n[secure_link]\n\nReply here if you'd like help.\n\nThanks,\n[advisor_first_name]"],
  ['paperwork_ready', 'Your paperwork is ready to review', "Hi [client_first_name],\n\nYour paperwork is ready for review.\n\nPlease use the link below when you are ready:\n[signature_link]\n\nReply here if anything looks confusing. [support_first_name] can walk through it with you.\n\nThanks,\n[advisor_first_name]"],
  ['signature_status_changed', 'Your onboarding step has been updated', "Hi [client_first_name],\n\nYour signature or transfer step has been updated.\n\nYou can check where things stand here:\n[secure_link]\n\nIf anything looks confusing, reply here and [support_first_name] can help.\n\nThanks,\n[advisor_first_name]"],
  ['onboarding_complete', "You're all set for the next step", "Hi [client_first_name],\n\nYou're all set for this part of onboarding.\n\nWe'll use what you shared to prepare for your planning conversation. Your secure page will stay available, so you can return to it if you need to check where things stand.\n\nThanks,\n[advisor_first_name]"],
  ['staff_handoff', 'A quick team update', "Hi [client_first_name],\n\nA quick note that [new_team_member_full_name] can help with your onboarding from here.\n\nSame secure page:\n[secure_link]\n\nReply here if anything feels confusing.\n\nThanks,\n[advisor_first_name]"],
  ['fresh_link', 'Here is your secure onboarding link', "Hi [client_first_name],\n\nHere is a fresh secure link for your onboarding page:\n[secure_link]\n\nYou can use this link to continue your checklist.\n\nThanks,\n[advisor_first_name]"],
  ['phone_walkthrough_followup', 'Thanks for walking through onboarding', "Hi [client_first_name],\n\nThank you for walking through part of onboarding with us.\n\nYour secure page is still available here:\n[secure_link]\n\nIf we need anything else, [support_first_name] will reach out.\n\nThanks,\n[advisor_first_name]"],
  ['email_reply_confirmed', 'We added your email reply', "Hi [client_first_name],\n\nThank you. We added the information you sent by email to your onboarding checklist.\n\nYou can check where things stand here:\n[secure_link]\n\nThanks,\n[advisor_first_name]"],
];

export const WELCOME_JOURNEY_EMAILS: WelcomeJourneyEmailTemplate[] = WELCOME_JOURNEY_EMAIL_ROWS.map(([id, subject, body]) => ({ id, subject, body }));

export function copyWelcomeJourney(value: WelcomeJourney = DEFAULT_WELCOME_JOURNEY): WelcomeJourney {
  return JSON.parse(JSON.stringify(value)) as WelcomeJourney;
}

const FIRM_DEFAULT_STORAGE_KEY = 'lantern.intake.welcome-journey.v1';
const JOURNEY_OWNERS: JourneyOwner[] = ['client', 'firm', 'advisor', 'staff', 'custodian', 'signing provider', 'outside signature path'];

function firmDefaultStorageKey(firmId: string | null | undefined): string | null {
  const normalized = firmId?.trim();
  return normalized ? `${FIRM_DEFAULT_STORAGE_KEY}.${encodeURIComponent(normalized)}` : null;
}

export function loadFirmWelcomeJourneyDefault(firmId: string | null | undefined): WelcomeJourney | null {
  const storageKey = firmDefaultStorageKey(firmId);
  if (!storageKey) return null;
  try {
    const raw = localStorage.getItem(storageKey);
    return raw ? sanitizeWelcomeJourney(JSON.parse(raw) as WelcomeJourney) : null;
  } catch { return null; }
}

export function saveFirmWelcomeJourneyDefault(firmId: string | null | undefined, value: WelcomeJourney): void {
  const storageKey = firmDefaultStorageKey(firmId);
  if (!storageKey) return;
  localStorage.setItem(storageKey, JSON.stringify(sanitizeWelcomeJourney(value)));
}

/** Privacy and account rules are product promises, never firm custom fields. */
export function sanitizeWelcomeJourney(value: WelcomeJourney): WelcomeJourney {
  const next = copyWelcomeJourney(value);
  next.privacy = copyWelcomeJourney(DEFAULT_WELCOME_JOURNEY).privacy;
  next.phone_walkthrough_label = DEFAULT_WELCOME_JOURNEY.phone_walkthrough_label;
  repairWelcomeJourneyTimeline(next);
  return next;
}

/** A client must always see at least one next step and the person responsible for it. */
function repairWelcomeJourneyTimeline(journey: WelcomeJourney): void {
  if (journey.timeline.length === 0) {
    const firstDefaultMilestone = copyWelcomeJourney(DEFAULT_WELCOME_JOURNEY).timeline[0];
    if (!firstDefaultMilestone) {
      throw new Error('The default welcome journey must include a timeline milestone.');
    }
    journey.timeline = [firstDefaultMilestone];
  }

  for (const step of journey.timeline) {
    if (!step.visible || JOURNEY_OWNERS.includes(step.owner)) continue;
    step.owner = DEFAULT_WELCOME_JOURNEY.timeline.find((candidate) => candidate.id === step.id)?.owner ?? 'firm';
  }

  if (journey.timeline.some((step) => step.visible && JOURNEY_OWNERS.includes(step.owner))) return;
  const first = journey.timeline[0];
  if (!first) return;
  first.visible = true;
  first.owner = DEFAULT_WELCOME_JOURNEY.timeline.find((candidate) => candidate.id === first.id)?.owner ?? 'firm';
}

export function hasForbiddenWelcomeJourneyCopy(value: WelcomeJourney): string[] {
  const copy = JSON.stringify(value);
  const failures: string[] = [];
  if (copy.includes('—')) failures.push('em dash');
  if (/\b(?:\d+\s*(?:minutes?|hours?|days?|weeks?)|within\s+\d+)\b/iu.test(copy)) failures.push('exact time promise');
  return failures;
}

export function resolveWelcomeMergeFields(text: string, fields: Record<string, string | undefined>): string {
  return text.replace(/\[([a-z_]+)\]/gu, (match, key: string) => fields[key] ?? match);
}

export function renderWelcomeJourneyEmail(id: string, fields: Record<string, string | undefined>): WelcomeJourneyEmailTemplate {
  const template = WELCOME_JOURNEY_EMAILS.find((candidate) => candidate.id === id) ?? WELCOME_JOURNEY_EMAILS[0];
  if (!template) {
    throw new Error('The welcome journey must include an email template.');
  }
  return { ...template, subject: resolveWelcomeMergeFields(template.subject, fields), body: resolveWelcomeMergeFields(template.body, fields) };
}
