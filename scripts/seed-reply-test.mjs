/**
 * Seeds the fixture for the reply → thread → stop-sequence end-to-end test.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ THE ADDRESS MUST NOT BE THE SENDING MAILBOX'S OWN, AND THAT IS NOT A  ║
 * ║  STYLE PREFERENCE.                                                        ║
 * ║                                                                           ║
 * ║  `reply-sync` matches an inbound message by                               ║
 * ║  `email_enrollments.to_email = <from address>`, and neither                ║
 * ║  `classifyInbound` nor `syncMailbox` skips the account's own address.      ║
 * ║  So if the contact were `husnain@outlio.io`, the sequence's own outbound   ║
 * ║  copy — which lands in that same INBOX, as the "Outlio mailbox test"       ║
 * ║  thread already demonstrated — would be read back, matched, classified as  ║
 * ║  a genuine reply, and would STOP THE SEQUENCE.                            ║
 * ║                                                                           ║
 * ║  The test would go green without a human ever replying. That is the exact  ║
 * ║  shape of the vacuous checks this project keeps finding, and building one  ║
 * ║  deliberately would be worse than not testing at all.                     ║
 * ║                                                                           ║
 * ║  Pass an address you can BOTH receive at and send from, that is not the    ║
 * ║  mailbox itself. Plus-addressing does not work: mail to                    ║
 * ║  `you+test@outlio.io` arrives, but the reply's From is the base address,   ║
 * ║  so `to_email` never matches.                                             ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 *   node scripts/seed-reply-test.mjs prospect@example.com
 *
 * ⚠️ WRITES TO PRODUCTION. It creates one contact, one campaign, one sequence
 * step and one enrollment. It sends nothing by itself — the send happens on the
 * next worker tick, which you trigger from /admin.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const TO = (process.argv[2] ?? '').trim().toLowerCase()
if (!TO || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(TO)) {
  console.error('Usage: node scripts/seed-reply-test.mjs <address-you-can-reply-from>')
  process.exit(1)
}

const env = {}
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].trim()
}
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

const { data: account, error: accountError } = await db
  .from('email_accounts')
  .select('id, workspace_id, from_email')
  .is('deleted_at', null)
  .limit(1)
  .single()
if (accountError) throw new Error(`no mailbox: ${accountError.message}`)

if (TO === account.from_email.toLowerCase()) {
  console.error(
    `\nRefusing: ${TO} is the sending mailbox itself.\n` +
      `The sequence's own outbound copy would land in that inbox, match the\n` +
      `enrollment, and stop the sequence without anyone replying. Use a\n` +
      `different address you can send from.\n`,
  )
  process.exit(1)
}

const WORKSPACE = account.workspace_id
const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')

// 1. The contact the reply must be attributed to.
const { data: contact, error: contactError } = await db
  .from('crm_contacts')
  .insert({
    workspace_id: WORKSPACE,
    full_name: 'Reply Test Prospect',
    source: 'manual',
  })
  .select('id')
  .single()
if (contactError) throw new Error(`contact: ${contactError.message}`)

const { error: emailError } = await db.from('crm_contact_emails').insert({
  workspace_id: WORKSPACE,
  contact_id: contact.id,
  address: TO,
  is_primary: true,
  // ⚠️ Required and not defaulted — omitting it fails with a not-null error
  // that names a column the caller never heard of.
  identity_key: `${WORKSPACE}:${TO}`,
})
if (emailError) throw new Error(`contact email: ${emailError.message}`)

/*
 * 2. A SALES SEQUENCE, not a broadcast. `reply-sync` stops every matched
 *    enrollment EXCEPT where the campaign type is `marketing_broadcast` — a
 *    reply to a newsletter is not an objection. Seeding a broadcast would
 *    therefore prove the opposite of what this test is for.
 */
const { data: campaign, error: campaignError } = await db
  .from('email_campaigns')
  .insert({
    workspace_id: WORKSPACE,
    name: `Reply E2E ${stamp}`,
    type: 'sales_sequence',
    status: 'running',
    account_id: account.id,
  })
  .select('id')
  .single()
if (campaignError) throw new Error(`campaign: ${campaignError.message}`)

// 3. One step, no wait, so the next tick sends it.
const { error: stepError } = await db.from('email_sequence_steps').insert({
  workspace_id: WORKSPACE,
  campaign_id: campaign.id,
  step_index: 1,
  wait_hours: 0,
  subject: 'Quick question',
  body_text:
    'This is an automated end-to-end test of Outlio\'s reply handling.\n\n' +
    'Please REPLY to this message with any text. Nothing else is required.',
})
if (stepError) throw new Error(`step: ${stepError.message}`)

// 4. Enrol. `to_email` is the join key reply-sync matches on.
const { data: enrollment, error: enrollError } = await db
  .from('email_enrollments')
  .insert({
    workspace_id: WORKSPACE,
    campaign_id: campaign.id,
    contact_id: contact.id,
    to_email: TO,
    status: 'active',
  })
  .select('id, status, to_email')
  .single()
if (enrollError) throw new Error(`enrollment: ${enrollError.message}`)

console.log('Fixture ready.\n')
console.log(`  workspace   ${WORKSPACE}`)
console.log(`  contact     ${contact.id}  (Reply Test Prospect)`)
console.log(`  address     ${TO}`)
console.log(`  campaign    ${campaign.id}  sales_sequence / running`)
console.log(`  enrollment  ${enrollment.id}  status=${enrollment.status}`)
console.log('\nNext:')
console.log('  1. /admin → Run workers now      (sends step 1)')
console.log(`  2. reply to it from ${TO}`)
console.log('  3. /admin → Run workers now      (syncs the reply)')
console.log('\nThen the enrollment should read status=stopped and the thread')
console.log('should carry contact_id — that is the assertion.')
