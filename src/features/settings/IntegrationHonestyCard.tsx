/* eslint-disable lantern-i18n/no-hardcoded-string */
import { FileText } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/ui/dialog';
import {
  getIntegrationHonestyCard,
  type IntegrationHonestyCardId,
  type IntegrationHonestySection,
} from '@/features/settings/integrationHonestyCards';

interface IntegrationHonestyCardProps {
  connectorId: IntegrationHonestyCardId;
}

function SectionList({ groups }: { groups: IntegrationHonestySection[] }) {
  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <div key={group.heading} className="space-y-1.5">
          <h4 className="text-xs font-semibold uppercase text-slate-500">
            {group.heading}
          </h4>
          <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed text-slate-700">
            {group.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function FlatList({ items }: { items: string[] }) {
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed text-slate-700">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

export function IntegrationHonestyCard({ connectorId }: IntegrationHonestyCardProps) {
  const card = getIntegrationHonestyCard(connectorId);

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          data-testid={`integration-honesty-trigger-${connectorId}`}
          aria-label={`See exactly what ${card.name} reads and writes`}
          className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
        >
          <FileText className="h-3.5 w-3.5" aria-hidden />
          <span>See exactly what is read and written</span>
        </button>
      </DialogTrigger>
      <DialogContent
        data-testid={`integration-honesty-dialog-${connectorId}`}
        className="max-w-3xl w-[92vw] max-h-[85vh] overflow-hidden bg-white p-0 flex flex-col"
      >
        <DialogHeader className="border-b border-slate-200 px-6 py-5 text-left">
          <div className="flex flex-wrap items-start justify-between gap-3 pr-8">
            <div className="space-y-2">
              <DialogTitle className="text-lg font-semibold text-slate-950">
                {card.name} Integration Honesty Card
              </DialogTitle>
              <DialogDescription className="max-w-2xl text-sm leading-relaxed text-slate-600">
                {card.summary}
              </DialogDescription>
            </div>
            <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-700">
              {card.status}
            </span>
          </div>
          <p className="text-xs font-medium text-slate-500">
            Last verified: {card.lastVerified}
          </p>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="space-y-6">
            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-slate-950">
                What this connector reads
              </h3>
              <SectionList groups={card.reads} />
            </section>

            <section className="space-y-3 border-t border-slate-200 pt-5">
              <h3 className="text-sm font-semibold text-slate-950">
                What this connector writes
              </h3>
              <SectionList groups={card.writes} />
            </section>

            <section className="space-y-3 border-t border-slate-200 pt-5">
              <h3 className="text-sm font-semibold text-slate-950">
                What this connector can never touch
              </h3>
              <FlatList items={card.neverTouch} />
            </section>

            <section className="space-y-3 border-t border-slate-200 pt-5">
              <h3 className="text-sm font-semibold text-slate-950">
                How writes are gated
              </h3>
              <ul className="space-y-2 text-sm leading-relaxed text-slate-700">
                {card.gating.map((gate) => (
                  <li key={gate.label} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                    <span className="font-semibold text-slate-900">{gate.label}: </span>
                    <span>{gate.detail}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="space-y-3 border-t border-slate-200 pt-5">
              <h3 className="text-sm font-semibold text-slate-950">
                Limits worth knowing
              </h3>
              <FlatList items={card.limits} />
            </section>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
