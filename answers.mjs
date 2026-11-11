// Trainer-editable educational examples, not individualized prescriptions.
const topics = [
  [/\b(warm.?up|warming)\b/i, 'Warm up with 5–10 minutes of easy movement, then lighter practice sets of your first exercise. Follow the warm-up in your trainer’s plan.'],
  [/\b(rest|between sets|break)\b/i, 'For many strength sessions, rest about 1–3 minutes between sets, longer for demanding heavy sets. Your trainer’s prescribed rest takes priority.'],
  [/\b(sore|soreness|recovery|rest day)\b/i, 'Mild muscle soreness can follow unfamiliar training. Easy movement, sleep and recovery days may help. Don’t train through sharp or worsening pain; contact your trainer or a clinician.'],
  [/\b(water|hydrate|hydration|drink)\b/i, 'Bring water and drink regularly, adjusting for heat, sweating and session length. Follow any fluid guidance from your clinician.'],
  [/\b(missed|skip|reschedule)\b/i, 'If you miss a workout, ask your trainer how to adjust the week. Don’t automatically double the next session.'],
  [/\b(weight|heavier|progress|increase)\b/i, 'Use a load you can control with the planned technique and repetitions. Ask your trainer before increasing it; gradual progress matters more than rushing.']
];
export function answer(text) {
  if (typeof text !== 'string' || text.length > 2000) return 'Please send one short training question (up to 2,000 characters).';
  if (/\b(pain|injur\w*|dizz\w*|faint\w*|chest|breathless)\b/i.test(text)) return 'Stop the exercise if it causes pain, dizziness or unusual symptoms. I can’t assess an injury. Contact your trainer or a qualified clinician; severe chest pain, fainting or breathing difficulty needs urgent medical help.';
  if (/^\s*(\/help|help|hi|hello|menu|\/start)\b/i.test(text)) return 'Trainer FAQ demo: ask about warm-up, rest between sets, soreness, water, missed workouts or increasing weight. These are general examples, not your personal training plan.';
  // Recovery intent takes priority over generic “rest”.
  const ordered = [topics[2], topics[0], topics[1], ...topics.slice(3)];
  return ordered.find(([pattern]) => pattern.test(text))?.[1] || 'I only answer the demo training FAQs. Type /help for topics, or ask your trainer for a personal answer.';
}
