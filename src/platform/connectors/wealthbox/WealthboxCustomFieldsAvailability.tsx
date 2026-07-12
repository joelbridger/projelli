/* eslint-disable lantern-i18n/no-hardcoded-string */

/**
 * A truthful, non-interactive status surface for the custom-field work that
 * already exists below the connector. It stays visible with Wealthbox so an
 * advisor can see the capability without being led to a control that cannot
 * work yet.
 */
export function WealthboxCustomFieldsAvailability() {
  return (
    <section
      data-testid="wealthbox-custom-fields-availability"
      aria-labelledby="wealthbox-custom-fields-heading"
      className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h4
          id="wealthbox-custom-fields-heading"
          className="text-sm font-medium text-slate-900"
        >
          Wealthbox custom fields
        </h4>
        <span className="text-xs font-medium text-slate-600">
          Available soon — needs the Ask-index bridge
        </span>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-slate-600">
        Custom fields are not imported or searchable yet. This will appear here
        when Ask can safely index and cite each field.
      </p>
    </section>
  );
}
