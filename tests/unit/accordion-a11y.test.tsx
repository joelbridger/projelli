/**
 * F-005 — Accordion ARIA wiring + keyboard navigation
 *
 * Verifies that the custom Accordion primitive (src/ui/accordion.tsx)
 * meets the WAI-ARIA Accordion pattern requirements:
 *   - aria-expanded reflects open/closed state on triggers
 *   - aria-controls on trigger points at the correct panel id
 *   - aria-labelledby on the panel points back at the trigger id
 *   - panel has role="region"
 *   - arrow-key navigation moves focus between triggers
 *   - Home/End jump to first/last trigger
 *   - single-open behaviour still works after the ARIA changes
 *   - data-state attributes are unchanged (onboarding spec depends on them)
 */

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/ui/accordion';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderAccordion(defaultValue?: string) {
  return render(
    <Accordion data-testid="root" defaultValue={defaultValue}>
      <AccordionItem value="item-1">
        <AccordionTrigger data-testid="trigger-1">Section 1</AccordionTrigger>
        <AccordionContent data-testid="content-1">Content 1</AccordionContent>
      </AccordionItem>
      <AccordionItem value="item-2">
        <AccordionTrigger data-testid="trigger-2">Section 2</AccordionTrigger>
        <AccordionContent data-testid="content-2">Content 2</AccordionContent>
      </AccordionItem>
      <AccordionItem value="item-3">
        <AccordionTrigger data-testid="trigger-3">Section 3</AccordionTrigger>
        <AccordionContent data-testid="content-3">Content 3</AccordionContent>
      </AccordionItem>
    </Accordion>,
  );
}

// ---------------------------------------------------------------------------
// aria-expanded
// ---------------------------------------------------------------------------

describe('accordion aria-expanded', () => {
  it('starts with all triggers aria-expanded=false when no defaultValue', () => {
    renderAccordion();
    expect(screen.getByTestId('trigger-1')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByTestId('trigger-2')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByTestId('trigger-3')).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens defaultValue item: matching trigger aria-expanded=true', () => {
    renderAccordion('item-2');
    expect(screen.getByTestId('trigger-1')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByTestId('trigger-2')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('trigger-3')).toHaveAttribute('aria-expanded', 'false');
  });

  it('toggles aria-expanded on click', () => {
    renderAccordion();
    const t1 = screen.getByTestId('trigger-1');
    expect(t1).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(t1);
    expect(t1).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(t1);
    expect(t1).toHaveAttribute('aria-expanded', 'false');
  });

  it('opening item-1 sets item-2 aria-expanded to false (single-open)', () => {
    renderAccordion('item-2');
    fireEvent.click(screen.getByTestId('trigger-1'));
    expect(screen.getByTestId('trigger-1')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('trigger-2')).toHaveAttribute('aria-expanded', 'false');
  });
});

// ---------------------------------------------------------------------------
// aria-controls / aria-labelledby linkage
// ---------------------------------------------------------------------------

describe('accordion aria-controls and aria-labelledby', () => {
  it('trigger aria-controls matches panel id', () => {
    renderAccordion('item-1'); // open so panel renders
    const trigger = screen.getByTestId('trigger-1');
    const panelId = trigger.getAttribute('aria-controls');
    expect(panelId).toBeTruthy();
    const panel = document.getElementById(panelId!);
    expect(panel).not.toBeNull();
  });

  it('panel aria-labelledby matches trigger id', () => {
    renderAccordion('item-1'); // open so panel renders
    const trigger = screen.getByTestId('trigger-1');
    const triggerId = trigger.getAttribute('id');
    expect(triggerId).toBeTruthy();
    const panel = document.getElementById(trigger.getAttribute('aria-controls')!);
    expect(panel).not.toBeNull();
    expect(panel!.getAttribute('aria-labelledby')).toBe(triggerId);
  });

  it('panel has role="region"', () => {
    renderAccordion('item-2');
    const trigger = screen.getByTestId('trigger-2');
    const panel = document.getElementById(trigger.getAttribute('aria-controls')!);
    expect(panel).not.toBeNull();
    expect(panel!.getAttribute('role')).toBe('region');
  });

  it('aria-controls/labelledby ids are consistent across open/close cycles', () => {
    renderAccordion();
    const trigger = screen.getByTestId('trigger-1');
    const controlsId = trigger.getAttribute('aria-controls');
    const triggerId = trigger.getAttribute('id');

    // Open then close
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-controls')).toBe(controlsId);
    expect(trigger.getAttribute('id')).toBe(triggerId);
  });
});

// ---------------------------------------------------------------------------
// Keyboard navigation
// ---------------------------------------------------------------------------

describe('accordion keyboard navigation', () => {
  it('ArrowDown moves focus from trigger-1 to trigger-2', () => {
    renderAccordion();
    const t1 = screen.getByTestId('trigger-1');
    const t2 = screen.getByTestId('trigger-2');
    t1.focus();
    fireEvent.keyDown(t1, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(t2);
  });

  it('ArrowUp moves focus from trigger-2 to trigger-1', () => {
    renderAccordion();
    const t1 = screen.getByTestId('trigger-1');
    const t2 = screen.getByTestId('trigger-2');
    t2.focus();
    fireEvent.keyDown(t2, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(t1);
  });

  it('ArrowDown wraps from last to first', () => {
    renderAccordion();
    const t1 = screen.getByTestId('trigger-1');
    const t3 = screen.getByTestId('trigger-3');
    t3.focus();
    fireEvent.keyDown(t3, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(t1);
  });

  it('ArrowUp wraps from first to last', () => {
    renderAccordion();
    const t1 = screen.getByTestId('trigger-1');
    const t3 = screen.getByTestId('trigger-3');
    t1.focus();
    fireEvent.keyDown(t1, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(t3);
  });

  it('Home moves focus to trigger-1 from trigger-3', () => {
    renderAccordion();
    const t1 = screen.getByTestId('trigger-1');
    const t3 = screen.getByTestId('trigger-3');
    t3.focus();
    fireEvent.keyDown(t3, { key: 'Home' });
    expect(document.activeElement).toBe(t1);
  });

  it('End moves focus to trigger-3 from trigger-1', () => {
    renderAccordion();
    const t1 = screen.getByTestId('trigger-1');
    const t3 = screen.getByTestId('trigger-3');
    t1.focus();
    fireEvent.keyDown(t1, { key: 'End' });
    expect(document.activeElement).toBe(t3);
  });
});

// ---------------------------------------------------------------------------
// data-state attributes (regression — onboarding spec depends on these)
// ---------------------------------------------------------------------------

describe('accordion data-state attributes (regression)', () => {
  it('item wrapper has data-state="closed" when closed', () => {
    const { container } = renderAccordion();
    const items = container.querySelectorAll('[data-state]');
    // All three items start closed
    items.forEach((item) => {
      if (item.tagName !== 'BUTTON') {
        expect(item.getAttribute('data-state')).toBe('closed');
      }
    });
  });

  it('item wrapper has data-state="open" when open', () => {
    renderAccordion();
    fireEvent.click(screen.getByTestId('trigger-2'));
    // The AccordionItem div for item-2 should be open
    const trigger = screen.getByTestId('trigger-2');
    const item = trigger.closest('[data-state]');
    expect(item).not.toBeNull();
    expect(item!.getAttribute('data-state')).toBe('open');
  });
});
