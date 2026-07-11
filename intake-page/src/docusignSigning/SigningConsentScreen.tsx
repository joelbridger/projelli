export function SigningConsentScreen({ onContinue }: { onContinue: () => void }): JSX.Element {
  return (
    <section className="panel signing-panel" aria-labelledby="docusign-consent-heading">
      <p className="eyebrow">Signature step</p>
      <h1 id="docusign-consent-heading" tabIndex={-1}>Review and sign with DocuSign</h1>
      <p>When you continue, your completed form and your name and email will be sent to DocuSign so they can collect your signature.</p>
      <p>DocuSign opens in a new tab. Keep this tab open while you sign.</p>
      <button className="primary-button" type="button" onClick={onContinue} aria-describedby="docusign-consent-heading">
        Continue to DocuSign
      </button>
    </section>
  );
}
