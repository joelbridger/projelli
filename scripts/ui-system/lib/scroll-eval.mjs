/**
 * Pure decision layer for the robot's scrollability probe.
 *
 * The live robot collects DOM facts. This module decides pass/fail so the
 * rule is unit-testable without launching a browser.
 */

export function evaluateScrollabilityFacts(facts) {
  const issues = [];
  if (!facts || facts.rootPresent !== true) {
    return { ok: false, issues: ['root not present'] };
  }
  if (facts.contentPresent !== true) {
    return { ok: false, issues: ['probe target not present'] };
  }

  const contentIsTaller = facts.contentTallerThanViewport === true || facts.rootOverflowed === true;
  if (!contentIsTaller) {
    return { ok: true, issues: [] };
  }

  if (!Number.isFinite(facts.scrollContainerCount) || facts.scrollContainerCount < 1) {
    issues.push('no scroll container');
  }
  if (facts.bestCanScroll !== true) {
    issues.push('best scroll container cannot scroll');
  }
  if (facts.reachedBottom !== true) {
    issues.push('scroll container did not reach bottom');
  }

  return { ok: issues.length === 0, issues };
}
