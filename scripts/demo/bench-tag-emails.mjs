// Tag each imported full-practice demo email to its intended client matter.
import { getPage, disconnect } from '../robot/connection.mjs';
import {
  PAGE_SIZE,
  VERIFY_SAMPLE_SIZE,
  buildExpectedByMatter,
  buildHouseholdsBySlug,
  buildTagPlanFromMessages,
  buildTaggingContext,
  loadOutbox,
  loadRoster,
  parseStoredMatters,
  printMatchLoudLists,
  printPreparationLoudLists,
  sampleExpectedMatterRows,
} from './email-tag-core.mjs';

async function invoke(page, command, args) {
  return page.evaluate(
    async ({ command: cmd, args: invokeArgs }) => {
      if (!window.__TAURI__?.core?.invoke)
        throw new Error('Tauri invoke bridge is not available');
      return window.__TAURI__.core.invoke(cmd, invokeArgs);
    },
    { command, args }
  );
}

async function listAllMessages(page) {
  const items = [];
  let offset = 0;
  let total = null;

  for (;;) {
    const result = await invoke(page, 'mail_list_messages', {
      query: { sortBy: 'date', sortDesc: true, limit: PAGE_SIZE, offset },
    });
    const pageItems = Array.isArray(result?.items) ? result.items : [];
    if (total == null) total = Number(result?.total ?? pageItems.length);
    items.push(...pageItems);
    offset += pageItems.length;

    if (items.length >= total) break;
    if (pageItems.length === 0) {
      console.log(
        `LOUD PAGINATION WARNING: mail_list_messages stopped early at ${items.length}/${total}`
      );
      break;
    }
  }

  return { items, total: total ?? items.length };
}

async function getCurrentMatterId(page, messageId) {
  const view = await invoke(page, 'mail_get_message', { id: messageId });
  return view?.matterId || null;
}

async function listMatterCount(page, matterId, matterMap) {
  const result = await invoke(page, 'mail_list_messages_by_matter', {
    matterId,
    matterMap,
    query: { sortBy: 'date', sortDesc: true, limit: 1, offset: 0 },
  });
  return Number(result?.total ?? 0);
}

const page = await getPage();
let exitCode = 0;

try {
  const [roster, appState] = await Promise.all([
    loadRoster(),
    page.evaluate(() => ({
      mattersRaw: localStorage.getItem('keepance:matters') || '',
    })),
  ]);

  const householdsBySlug = buildHouseholdsBySlug(roster);
  const { records: outboxRecords, missingRoster } =
    await loadOutbox(householdsBySlug);
  const matters = parseStoredMatters(appState.mattersRaw);
  const context = buildTaggingContext(roster, outboxRecords, matters);
  const matterMap = context.matterMap;

  console.log(`loaded roster households: ${roster.length}`);
  console.log(`loaded outbox messages: ${outboxRecords.length}`);
  console.log(`loaded app matters: ${matters.length}`);
  console.log(`loaded app mail-folder mappings: ${matterMap.length}`);

  printPreparationLoudLists({ missingRoster, context });

  const { items: messages, total } = await listAllMessages(page);
  console.log(`mail store messages read: ${messages.length}/${total}`);

  const { matched, unmatchedLikelyDemo, ambiguous } =
    buildTagPlanFromMessages(messages, context);
  printMatchLoudLists({ unmatchedLikelyDemo, ambiguous });

  console.log(`matched imported demo messages: ${matched.length}`);

  let alreadyCorrect = 0;
  let retagged = 0;
  let failed = 0;

  for (const entry of matched) {
    try {
      const currentMatterId = await getCurrentMatterId(page, entry.message.id);
      if (currentMatterId === entry.matterId) {
        alreadyCorrect += 1;
        continue;
      }
      await invoke(page, 'mail_retag_message_matter', {
        messageId: entry.message.id,
        matterId: entry.matterId,
      });
      retagged += 1;
      console.log(
        `tagged ${entry.outbox.householdSlug.padEnd(32)} -> ${entry.matterId} | ${entry.message.subject}`
      );
    } catch (error) {
      failed += 1;
      console.log(
        `LOUD TAG ERROR: ${entry.outbox.householdSlug} | ${entry.message.id} | ${String(error).slice(0, 240)}`
      );
    }
  }

  const expectedByMatter = buildExpectedByMatter(matched);

  console.log('\nVERIFY sample clients:');
  const sampleRows = sampleExpectedMatterRows(
    expectedByMatter,
    VERIFY_SAMPLE_SIZE
  );
  for (const row of sampleRows) {
    const count = await listMatterCount(page, row.matterId, matterMap);
    console.log(
      `  ${row.matterName} (${row.householdSlug}) -> ${count} messages by matter; ${row.expectedMatched} matched this run`
    );
  }

  let totalTaggedByMatter = 0;
  for (const row of expectedByMatter.values()) {
    totalTaggedByMatter += await listMatterCount(page, row.matterId, matterMap);
  }

  console.log('\nTOTAL TAGGED SUMMARY');
  console.log(`  mail store messages read: ${messages.length}/${total}`);
  console.log(`  outbox messages available: ${outboxRecords.length}`);
  console.log(`  matched demo messages: ${matched.length}`);
  console.log(`  already correctly filed: ${alreadyCorrect}`);
  console.log(`  newly tagged: ${retagged}`);
  console.log(
    `  unmatched likely demo messages: ${unmatchedLikelyDemo.length}`
  );
  console.log(`  ambiguous matches skipped: ${ambiguous.length}`);
  console.log(`  tag errors: ${failed}`);
  console.log(
    `  total messages visible across matched demo matters now: ${totalTaggedByMatter}`
  );

  exitCode =
    failed > 0 || ambiguous.length > 0 || unmatchedLikelyDemo.length > 0
      ? 1
      : 0;
} finally {
  await disconnect().catch(() => {});
}

process.exitCode = exitCode;
