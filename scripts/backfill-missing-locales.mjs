#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const localePath = (locale) => resolve(repoRoot, 'src/locales', `${locale}.json`);

const translations = {
  es: {
    'common.command-palette.open': 'Paleta de comandos (Ctrl+K)',
    'common.trash.retention-days_one': '{{count}} día',
    'common.trash.retention-days_other': '{{count}} días',
    'common.trash.retention-custom': 'Personalizado',
    'common.trash.custom-days-label': 'Días personalizados',
    'common.trash.empty-title': 'La papelera está vacía',
    'common.trash.empty-description-never': 'Los archivos eliminados aparecen aquí.',
    'common.trash.empty-description-days_one': 'Los archivos eliminados permanecen aquí {{count}} día.',
    'common.trash.empty-description-days_other': 'Los archivos eliminados permanecen aquí {{count}} días.',
    'common.trash.settings-menu': 'Configuración',
    'common.trash.empty-menu': 'Vaciar papelera',
    'common.trash.more-actions': 'Acciones de la papelera',
    'common.trash.item-count_one': '({{count}} elemento)',
    'common.trash.item-count_other': '({{count}} elementos)',
    'common.trash.today': 'Hoy',
    'common.trash.yesterday': 'Ayer',
    'common.trash.days-ago_one': 'Hace {{count}} día',
    'common.trash.days-ago_other': 'Hace {{count}} días',
    'common.trash.oldest': 'Más antiguo {{date}}',
    'common.trash.summary': '{{size}} en la papelera',
    'common.trash.summary-with-oldest': '{{size}} en la papelera. {{oldest}}',
    'settings.privacy.optional-sharing.title': 'Compartir opcional',
    'settings.privacy.optional-sharing.description': 'Lantern mantiene tu trabajo en este equipo. El uso compartido opcional está desactivado salvo que lo actives.',
    'settings.privacy.optional-sharing.details-label': '¿Qué se comparte?',
    'settings.privacy.design-partner.not-sent': 'Nunca tu contenido, nombres de archivos, nombres de clientes ni prompts.',
    'settings.memory-facts.add-toggle': 'Añadir dato',
    'settings.mobile-page.full-guide': 'Guía completa',
    'settings.mobile-page.providers.icloud.label': 'iCloud Drive',
    'settings.mobile-page.providers.icloud.guidance': 'Mejor si usas dispositivos Apple.',
    'settings.mobile-page.providers.icloud.open-app': 'Abrir Archivos en iPhone',
    'settings.mobile-page.providers.dropbox.label': 'Dropbox',
    'settings.mobile-page.providers.dropbox.guidance': 'Funciona en Mac, Windows, iPhone y Android.',
    'settings.mobile-page.providers.dropbox.open-app': 'Abrir Dropbox en iPhone',
    'settings.mobile-page.providers.syncthing.label': 'Syncthing',
    'settings.mobile-page.providers.syncthing.guidance': 'Mantiene los datos entre tus propios dispositivos sin una cuenta en la nube.',
    'settings.mobile-page.providers.gdrive.label': 'Google Drive',
    'settings.mobile-page.providers.gdrive.guidance': 'Mejor si ya usas Google Drive, especialmente en Android.',
    'settings.voice.status-checking': 'Comprobando disponibilidad de voz',
    'settings.voice.status-missing': 'La voz no está disponible en esta versión',
    'settings.voice.status-denied': 'Permiso de micrófono denegado. Permite el acceso al micrófono para usar la voz.',
    'settings.voice.status-ready': 'Listo',
    'workspace.file-tree.open-on-desktop-browser-only': 'Solo está disponible en la app de escritorio.',
    'workspace.file-tree.open-on-desktop-failed': 'No se pudo abrir la carpeta: {{error}}',
    'workspace.file-tree.empty-title': 'Aún no hay archivos',
    'workspace.file-tree.empty-description': 'Crea o añade un archivo para empezar.',
    'workspace.file-tree.selected-count_one': '{{count}} seleccionado',
    'workspace.file-tree.selected-count_other': '{{count}} seleccionados',
    'workspace.file-tree.clear-selection': 'Borrar selección',
    'workspace.file-tree.download-selected': 'Descargar archivos seleccionados',
    'workspace.file-tree.delete-selected': 'Eliminar elementos seleccionados',
    'workspace.documents.title': 'Documentos',
    'workspace.documents.more-actions': 'Más acciones de archivo',
    'workspace.documents.trust-banner': 'Indexado localmente. Nada se sube.',
    'workspace.documents.trust-dismiss': 'Descartar nota de confianza',
    'workspace.documents.empty-title': 'Aún no hay archivos',
    'workspace.documents.empty-body': 'Crea o añade un archivo para empezar.',
    'workspace.documents.all-files': 'Todos los archivos',
    'workspace.documents.search-results_one': '{{count}} resultado',
    'workspace.documents.search-results_other': '{{count}} resultados',
    'workspace.documents.no-results-title': 'Sin resultados',
    'workspace.documents.no-results-body': 'Ningún archivo coincide con tu búsqueda. Prueba con otro nombre.',
    'editor.autosave.saved': 'Guardado',
    'editor.autosave.unsaved': 'Cambios sin guardar',
    'editor.autosave.saving': 'Guardando',
    'editor.autosave.save-failed': 'Error al guardar',
    'editor.autosave.retry': 'Reintentar',
    'editor.autosave.last-saved': 'Último guardado {{time}}',
    'editor.autosave.unsaved-tooltip': 'Cambios sin guardar. El guardado automático se ejecutará pronto.',
    'editor.autosave.save-failed-tooltip': 'Error al guardar: {{error}}',
    'editor.autosave.unknown-error': 'error desconocido',
    'editor.autosave.no-file-open': 'No hay archivo abierto',
    'workflow.browser.search-placeholder': 'Buscar o introducir URL',
    'workflow.interview.running': 'Ejecutando',
    'workflow.interview.cancel': 'Cancelar',
    'workflow.interview.required': 'Este campo es obligatorio',
    'workflow.interview.run': 'Ejecutar',
    'workflow.associate.egress-local': 'Se ejecuta en tu equipo. Nada sale.',
    'workflow.associate.egress-cloud': 'Se ejecuta en tu proveedor de IA con tu propia clave.',
    'workflow.associate.egress-none': 'Conecta un proveedor de IA para ejecutarlo.',
    'workflow.associate.categories.legal.label': 'Legal',
    'workflow.associate.categories.legal.description': 'Litigios, discovery, admisión de clientes y trabajo transaccional',
    'workflow.associate.categories.tax.label': 'Impuestos',
    'workflow.associate.categories.tax.description': 'Investigación fiscal, planificación y flujos de cumplimiento',
    'workflow.associate.categories.consulting.label': 'Consultoría',
    'workflow.associate.categories.consulting.description': 'Proyectos de cliente, estrategia y entregables',
    'workflow.associate.categories.advisors.label': 'Asesores',
    'workflow.associate.categories.advisors.description': 'Flujos de práctica asesora y gestión de clientes',
    'workflow.associate.categories.research.label': 'Investigación',
    'workflow.associate.categories.research.description': 'Investigación y análisis generales',
    'workflow.associate.categories.analysis.label': 'Análisis',
    'workflow.associate.categories.analysis.description': 'Análisis de documentos y datos',
    'workflow.associate.categories.planning.label': 'Planificación',
    'workflow.associate.categories.planning.description': 'Planificación de negocios y proyectos',
    'workflow.associate.categories.kickoff.label': 'Inicio',
    'workflow.associate.categories.kickoff.description': 'Alta de nuevos proyectos y clientes',
    'workflow.associate.categories.custom.label': 'Personalizado',
    'workflow.associate.categories.custom.description': 'Tus propias plantillas guardadas',
    'workflow.associate.trust-no-ai': 'No hay IA conectada',
    'workflow.associate.trust-assured': 'Ruta de IA Assured',
    'workflow.associate.trust-local': 'Solo IA local',
    'workflow.associate.details': 'Detalles',
    'workflow.associate.trust-open-settings': 'Abrir ajustes de IA',
    'workflow.associate.trust-direct': 'Envía directamente a {{provider}}',
    'workflow.execution.generating': 'Generando',
    'workflow.execution.no-steps': 'Sin pasos',
    'workflow.execution.export-docx-description': 'Añade el nombre de la firma para esta exportación.',
    'workflow.execution.complete': 'Completado',
    'workflow.execution.export-docx': 'Exportar .docx',
    'workflow.execution.created-file': 'Archivo creado',
    'workflow.execution.preview-text': 'Vista previa de texto',
    'workflow.execution.draft-ready': 'Borrador listo',
    'workflow.execution.show-all-steps': 'Mostrar todos los pasos',
    'workflow.execution.step-short': 'Paso {{current}}/{{total}}',
    'workflow.execution.cancel': 'Cancelar',
    'workflow.execution.failed': 'Falló',
    'workflow.execution.export': 'Exportar',
    'workflow.execution.export-pptx': 'Exportar .pptx',
    'workflow.execution.more-actions': 'Más acciones',
    'workflow.execution.open': 'Abrir',
    'workflow.execution.generating-step': 'Generando {{step}}',
    'workflow.execution.firm-name-placeholder': 'p. ej. Acme Law PLLC',
    'workflow.execution.needs-client-title': 'Elige primero tu cliente.',
    'workflow.execution.workflow-failed': 'El flujo de trabajo falló',
    'workflow.execution.hide-all-steps': 'Ocultar todos los pasos',
    'workflow.execution.firm-name': 'Nombre de la firma',
    'workflow.execution.needs-client-body': 'Elige un cliente y vuelve a ejecutar el flujo de trabajo.',
    'workflow.panel.template-actions': 'Acciones para {{name}}',
    'workflow.panel.ai-calls-count_other': '{{count}} llamadas de IA',
    'workflow.panel.local-estimate-note': 'Este flujo de trabajo usa IA local. Sin cargo del proveedor.',
    'workflow.panel.delete-template': 'Eliminar',
    'workflow.panel.current-execution': 'Ejecución actual',
    'workflow.panel.actions': 'Acciones del flujo de trabajo',
    'workflow.panel.estimate-line': '{{steps}} · {{calls}} · est. {{cost}}',
    'workflow.panel.run-history': 'Historial de ejecuciones',
    'workflow.panel.estimate-note': 'Solo estimación. Tu proveedor de IA factura el coste real.',
    'workflow.panel.ai-calls-count_one': '1 llamada de IA',
    'workflow.panel.start-workflow': 'Iniciar flujo de trabajo',
    'workflow.fork.ai-instructions': 'Instrucciones de IA',
    'workflow.marketplace.search-templates': 'Buscar plantillas',
    'ask.book.summaries-note-title': 'Respondido a partir de Client Maps guardados. No se buscaron documentos entre clientes.',
    'ask.scope-menu.this-client': 'Este cliente',
    'ask.scope-menu.all-clients': 'Todos los clientes',
    'ask.scope-menu.all-selected': 'Todos',
    'ask.scope-menu.email': 'Correo',
    'ask.scope-menu.documents': 'Documentos',
    'ask.scope-menu.documents-selected': 'Docs',
    'ask.scope-menu.book-overview': 'Resumen del libro',
    'ask.scope-menu.book-selected': 'Libro',
    'ask.composer.placeholder-client': 'Preguntar a {{name}}',
    'ask.composer.placeholder-email': 'Preguntar sobre correo importado',
    'ask.composer.placeholder-documents': 'Preguntar en tus documentos',
    'ask.composer.placeholder-book': 'Preguntar en Client Maps guardados',
    'ask.demo-intro.body': 'Las respuestas citan estos archivos. Haz clic en una cita para abrir la fuente.',
    'ask.indexing.notice': 'Indexa documentos para respuestas con citas.',
    'ask.indexing.enable': 'Activar',
    'ask.file-access.prompt-title': '¿Permitir acceso de IA a archivos para {{scopeLabel}}?',
    'ask.file-access.prompt-body': 'Puede buscar y leer archivos. El texto de los archivos puede ir a {{provider}}. Cualquier edición seguirá pidiendo permiso.',
    'ask.file-access.reconfirm': 'Este chat ahora cubre {{scopeLabel}}, así que necesita tu confirmación otra vez.',
    'ask.file-access.details-link': 'Detalles',
    'ask.file-access.details': 'Hasta que lo permitas, la IA solo usa lo que escribes y los archivos que abres o adjuntas tú mismo.',
    'ask.file-access.allow': 'Permitir',
    'ask.file-access.allow-all': 'Permitir todo',
    'ask.file-access.not-now': 'Ahora no',
    'ask.file-access.turn-off': 'Desactivar',
    'ask.file-access.granted': 'Acceso a archivos activado. Las ediciones siguen pidiendo permiso.',
    'ask.file-access.denied': 'Acceso a archivos desactivado.',
    'ask.action.searching': 'Buscando',
    'ask.action.answering': 'Respondiendo',
    'ask.action.searching-documents': 'Buscando en tus documentos',
    'ask.conversations.title': 'Conversaciones',
    'ask.conversations.show': 'Mostrar conversaciones',
    'ask.conversations.hide': 'Ocultar conversaciones',
    'ask.conversations.new-question': 'Nueva pregunta',
    'ask.conversations.new': 'Nueva',
    'ask.sources.provenance-title': 'Esto es una captura exportada, no una conexión activa.',
    'ask.sources.provenance-stale-title': 'Esta captura exportada puede estar desactualizada. Vuelve a exportar desde la herramienta para obtener lo más reciente.',
    'ask.sources.provenance-stale-suffix': 'puede estar desactualizada',
    'ask.sources.status.verified': 'Verificado',
    'ask.sources.status.found': 'Encontrado',
    'ask.sources.status.quote-not-found': 'Cita no encontrada',
    'ask.sources.status.quote-mismatch': 'La cita no coincide',
    'ask.sources.status.wrong-client': 'Cliente incorrecto',
    'ask.sources.status.could-not-verify': 'No se pudo verificar',
    'ask.sources.status.verified-title': 'La fuente guardada se comprobó y contiene esta cita exacta.',
    'ask.sources.status.checking-title': 'Comprobando esta cita contra la fuente guardada.',
    'ask.sources.status.found-title': 'Se encontró esta fuente. La comprobación automática no pudo confirmar la cita exacta.',
    'ask.answer-scope.settings-label': 'Ajustes de respuesta',
    'ask.answer-blocks.label.files': 'Archivos',
    'ask.answer-blocks.label.nothing-found': 'Sin coincidencia de archivo',
    'ask.answer-blocks.label.files-unverified': 'Encontrado, no verificado',
    'ask.answer-blocks.label.files-checking': 'Comprobando',
    'ask.answer-blocks.label.general': 'General',
    'ask.answer-blocks.label.draft': 'Borrador',
    'ask.answer-blocks.general-verifyline': 'Conocimiento general. Verifica las reglas actuales.',
    'ask.answer-blocks.draft-note': 'Borrador para que lo revises antes de enviar. Nada se envía automáticamente.',
    'ask.answer-blocks.cited-attestation': 'Citado desde tus archivos. Abre cualquier número para comprobarlo.',
    'ask.answer-blocks.show-cited-files': 'Mostrar archivos citados',
    'ask.answer-blocks.nothing-found-note': 'Sin coincidencia de archivo. La orientación general está marcada.',
    'ask.answer-blocks.tally.cited-claims_one': '1 afirmación citada desde tus archivos',
    'ask.answer-blocks.tally.cited-claims_other': '{{count}} afirmaciones citadas desde tus archivos',
    'ask.answer-blocks.tally.checking-sources_one': 'Comprobando 1 fuente',
    'ask.answer-blocks.tally.checking-sources_other': 'Comprobando {{count}} fuentes',
    'ask.answer-blocks.tally.sources-unverified_one': '1 fuente encontrada, no verificada',
    'ask.answer-blocks.tally.sources-unverified_other': '{{count}} fuentes encontradas, no verificadas',
    'ask.answer-blocks.tally.general': 'General',
    'ask.turn.view-ai-status': 'Ver estado de la IA',
    'ask.turn.decline-note-client': 'No se encontró nada en tus archivos. Prueba con una pregunta sobre este cliente.',
    'ask.turn.decline-note-all': 'No se encontró nada en tus archivos. Prueba con una pregunta sobre tus clientes.',
    'ask.turn.still-importing-decline': 'Todavía importando. Inténtalo de nuevo cuando termine.',
    'ask.turn.uncited-warning': 'No está citado desde tus archivos. Verifícalo antes de confiar en ello.',
    'ask.turn.stale-plan-warning': 'Usa exportaciones de planes antiguas: {{exports}}. Vuelve a exportar para actualizar.',
    'ask.turn.stale-plan-age_one': '1 día de antigüedad',
    'ask.turn.stale-plan-age_other': '{{count}} días de antigüedad',
    'ask.turn.answer-actions': 'Acciones de respuesta',
    'ask.turn.saving': 'Guardando',
    'ask.turn.save-to-doc': 'Guardar en doc',
    'ask.turn.importing-banner': 'Importando archivos y correo. Las respuestas pueden estar incompletas.',
    'ask.sample-bridge.dismiss': 'Descartar',
    'privacy.egress.local-pending.label': 'La IA local se está configurando',
    'privacy.egress.local-pending.note': 'Tu IA en este dispositivo aún se está descargando o iniciando. No se ha enviado nada a ninguna parte. Revisa su progreso en Ajustes y vuelve a intentarlo.',
    'privacy.retention.change': 'Cambiar',
    'privacy.retention.more-actions': 'Más acciones de archivos eliminados',
    'meetings.notice-card.settings-advanced-summary': 'Aviso avanzado de grabación',
    'meetings.notice-card.settings-name-placeholder': 'Aviso de grabación - {advisor}',
  },
  de: {
    'common.command-palette.open': 'Befehlspalette (Ctrl+K)',
    'common.trash.retention-days_one': '{{count}} Tag',
    'common.trash.retention-days_other': '{{count}} Tage',
    'common.trash.retention-custom': 'Benutzerdefiniert',
    'common.trash.custom-days-label': 'Benutzerdefinierte Tage',
    'common.trash.empty-title': 'Papierkorb ist leer',
    'common.trash.empty-description-never': 'Gelöschte Dateien erscheinen hier.',
    'common.trash.empty-description-days_one': 'Gelöschte Dateien bleiben hier {{count}} Tag.',
    'common.trash.empty-description-days_other': 'Gelöschte Dateien bleiben hier {{count}} Tage.',
    'common.trash.settings-menu': 'Einstellungen',
    'common.trash.empty-menu': 'Papierkorb leeren',
    'common.trash.more-actions': 'Papierkorb-Aktionen',
    'common.trash.item-count_one': '({{count}} Element)',
    'common.trash.item-count_other': '({{count}} Elemente)',
    'common.trash.today': 'Heute',
    'common.trash.yesterday': 'Gestern',
    'common.trash.days-ago_one': 'Vor {{count}} Tag',
    'common.trash.days-ago_other': 'Vor {{count}} Tagen',
    'common.trash.oldest': 'Ältestes {{date}}',
    'common.trash.summary': '{{size}} im Papierkorb',
    'common.trash.summary-with-oldest': '{{size}} im Papierkorb. {{oldest}}',
    'settings.privacy.optional-sharing.title': 'Optionales Teilen',
    'settings.privacy.optional-sharing.description': 'Lantern behält deine Arbeit auf diesem Computer. Optionales Teilen ist aus, bis du es einschaltest.',
    'settings.privacy.optional-sharing.details-label': 'Was wird geteilt?',
    'settings.privacy.design-partner.not-sent': 'Nie deine Inhalte, Dateinamen, Mandantennamen oder Prompts.',
    'settings.memory-facts.add-toggle': 'Fakt hinzufügen',
    'settings.mobile-page.full-guide': 'Vollständige Anleitung',
    'settings.mobile-page.providers.icloud.label': 'iCloud Drive',
    'settings.mobile-page.providers.icloud.guidance': 'Am besten, wenn du Apple-Geräte verwendest.',
    'settings.mobile-page.providers.icloud.open-app': 'Dateien auf dem iPhone öffnen',
    'settings.mobile-page.providers.dropbox.label': 'Dropbox',
    'settings.mobile-page.providers.dropbox.guidance': 'Funktioniert mit Mac, Windows, iPhone und Android.',
    'settings.mobile-page.providers.dropbox.open-app': 'Dropbox auf dem iPhone öffnen',
    'settings.mobile-page.providers.syncthing.label': 'Syncthing',
    'settings.mobile-page.providers.syncthing.guidance': 'Hält Daten zwischen deinen eigenen Geräten synchron, ohne Cloud-Konto.',
    'settings.mobile-page.providers.gdrive.label': 'Google Drive',
    'settings.mobile-page.providers.gdrive.guidance': 'Am besten, wenn du Google Drive bereits nutzt, besonders auf Android.',
    'settings.voice.status-checking': 'Sprachverfügbarkeit wird geprüft',
    'settings.voice.status-missing': 'Sprache in diesem Build nicht verfügbar',
    'settings.voice.status-denied': 'Mikrofonberechtigung verweigert. Erlaube den Mikrofonzugriff, um Sprache zu verwenden.',
    'settings.voice.status-ready': 'Bereit',
    'workspace.file-tree.open-on-desktop-browser-only': 'Nur in der Desktop-App verfügbar.',
    'workspace.file-tree.open-on-desktop-failed': 'Ordner konnte nicht geöffnet werden: {{error}}',
    'workspace.file-tree.empty-title': 'Noch keine Dateien',
    'workspace.file-tree.empty-description': 'Erstelle oder füge eine Datei hinzu, um zu starten.',
    'workspace.file-tree.selected-count_one': '{{count}} ausgewählt',
    'workspace.file-tree.selected-count_other': '{{count}} ausgewählt',
    'workspace.file-tree.clear-selection': 'Auswahl löschen',
    'workspace.file-tree.download-selected': 'Ausgewählte Dateien herunterladen',
    'workspace.file-tree.delete-selected': 'Ausgewählte Elemente löschen',
    'workspace.documents.title': 'Dokumente',
    'workspace.documents.more-actions': 'Weitere Dateiaktionen',
    'workspace.documents.trust-banner': 'Lokal indexiert. Nichts hochgeladen.',
    'workspace.documents.trust-dismiss': 'Vertrauenshinweis schließen',
    'workspace.documents.empty-title': 'Noch keine Dateien',
    'workspace.documents.empty-body': 'Erstelle oder füge eine Datei hinzu, um zu starten.',
    'workspace.documents.all-files': 'Alle Dateien',
    'workspace.documents.search-results_one': '{{count}} Ergebnis',
    'workspace.documents.search-results_other': '{{count}} Ergebnisse',
    'workspace.documents.no-results-title': 'Keine Ergebnisse',
    'workspace.documents.no-results-body': 'Keine Dateien passen zu deiner Suche. Versuche einen anderen Namen.',
    'editor.autosave.saved': 'Gespeichert',
    'editor.autosave.unsaved': 'Ungespeicherte Änderungen',
    'editor.autosave.saving': 'Speichern',
    'editor.autosave.save-failed': 'Speichern fehlgeschlagen',
    'editor.autosave.retry': 'Erneut versuchen',
    'editor.autosave.last-saved': 'Zuletzt gespeichert {{time}}',
    'editor.autosave.unsaved-tooltip': 'Ungespeicherte Änderungen. Automatisches Speichern läuft in Kürze.',
    'editor.autosave.save-failed-tooltip': 'Speichern fehlgeschlagen: {{error}}',
    'editor.autosave.unknown-error': 'unbekannter Fehler',
    'editor.autosave.no-file-open': 'Keine Datei geöffnet',
    'workflow.browser.search-placeholder': 'Suchen oder URL eingeben',
    'workflow.interview.running': 'Läuft',
    'workflow.interview.cancel': 'Abbrechen',
    'workflow.interview.required': 'Dieses Feld ist erforderlich',
    'workflow.interview.run': 'Ausführen',
    'workflow.associate.egress-local': 'Läuft auf deinem Computer. Nichts verlässt ihn.',
    'workflow.associate.egress-cloud': 'Läuft bei deinem KI-Anbieter mit deinem eigenen Schlüssel.',
    'workflow.associate.egress-none': 'Verbinde einen KI-Anbieter, um dies auszuführen.',
    'workflow.associate.categories.legal.label': 'Recht',
    'workflow.associate.categories.legal.description': 'Prozesse, Discovery, Mandantenaufnahme und Transaktionsarbeit',
    'workflow.associate.categories.tax.label': 'Steuern',
    'workflow.associate.categories.tax.description': 'Steuerrecherche, Planung und Compliance-Workflows',
    'workflow.associate.categories.consulting.label': 'Beratung',
    'workflow.associate.categories.consulting.description': 'Kundenprojekte, Strategie und Ergebnisse',
    'workflow.associate.categories.advisors.label': 'Berater',
    'workflow.associate.categories.advisors.description': 'Workflows für Beratungspraxen und Mandantenverwaltung',
    'workflow.associate.categories.research.label': 'Recherche',
    'workflow.associate.categories.research.description': 'Allgemeine Recherche und Analyse',
    'workflow.associate.categories.analysis.label': 'Analyse',
    'workflow.associate.categories.analysis.description': 'Dokumenten- und Datenanalyse',
    'workflow.associate.categories.planning.label': 'Planung',
    'workflow.associate.categories.planning.description': 'Geschäfts- und Projektplanung',
    'workflow.associate.categories.kickoff.label': 'Start',
    'workflow.associate.categories.kickoff.description': 'Onboarding neuer Projekte und Mandanten',
    'workflow.associate.categories.custom.label': 'Benutzerdefiniert',
    'workflow.associate.categories.custom.description': 'Deine eigenen gespeicherten Vorlagen',
    'workflow.associate.trust-no-ai': 'Keine KI verbunden',
    'workflow.associate.trust-assured': 'Assured-KI-Route',
    'workflow.associate.trust-local': 'Nur lokale KI',
    'workflow.associate.details': 'Details',
    'workflow.associate.trust-open-settings': 'KI-Einstellungen öffnen',
    'workflow.associate.trust-direct': 'Sendet direkt an {{provider}}',
    'workflow.execution.generating': 'Wird erstellt',
    'workflow.execution.no-steps': 'Keine Schritte',
    'workflow.execution.export-docx-description': 'Füge den Firmennamen für diesen Export hinzu.',
    'workflow.execution.complete': 'Abgeschlossen',
    'workflow.execution.export-docx': '.docx exportieren',
    'workflow.execution.created-file': 'Datei erstellt',
    'workflow.execution.preview-text': 'Textvorschau',
    'workflow.execution.draft-ready': 'Entwurf bereit',
    'workflow.execution.show-all-steps': 'Alle Schritte anzeigen',
    'workflow.execution.step-short': 'Schritt {{current}}/{{total}}',
    'workflow.execution.cancel': 'Abbrechen',
    'workflow.execution.failed': 'Fehlgeschlagen',
    'workflow.execution.export': 'Exportieren',
    'workflow.execution.export-pptx': '.pptx exportieren',
    'workflow.execution.more-actions': 'Weitere Aktionen',
    'workflow.execution.open': 'Öffnen',
    'workflow.execution.generating-step': '{{step}} wird erstellt',
    'workflow.execution.firm-name-placeholder': 'z. B. Acme Law PLLC',
    'workflow.execution.needs-client-title': 'Wähle zuerst deinen Mandanten.',
    'workflow.execution.workflow-failed': 'Workflow fehlgeschlagen',
    'workflow.execution.hide-all-steps': 'Alle Schritte ausblenden',
    'workflow.execution.firm-name': 'Firmenname',
    'workflow.execution.needs-client-body': 'Wähle einen Mandanten und starte den Workflow dann erneut.',
    'workflow.panel.template-actions': 'Aktionen für {{name}}',
    'workflow.panel.ai-calls-count_other': '{{count}} KI-Aufrufe',
    'workflow.panel.local-estimate-note': 'Dieser Workflow läuft mit lokaler KI. Keine Anbietergebühr.',
    'workflow.panel.delete-template': 'Löschen',
    'workflow.panel.current-execution': 'Aktueller Lauf',
    'workflow.panel.actions': 'Workflow-Aktionen',
    'workflow.panel.estimate-line': '{{steps}} · {{calls}} · ca. {{cost}}',
    'workflow.panel.run-history': 'Laufhistorie',
    'workflow.panel.estimate-note': 'Nur Schätzung. Dein KI-Anbieter berechnet die tatsächlichen Kosten.',
    'workflow.panel.ai-calls-count_one': '1 KI-Aufruf',
    'workflow.panel.start-workflow': 'Workflow starten',
    'workflow.fork.ai-instructions': 'KI-Anweisungen',
    'workflow.marketplace.search-templates': 'Vorlagen suchen',
    'ask.book.summaries-note-title': 'Beantwortet aus gespeicherten Client Maps. Dokumente wurden nicht mandantenübergreifend durchsucht.',
    'ask.scope-menu.this-client': 'Dieser Mandant',
    'ask.scope-menu.all-clients': 'Alle Mandanten',
    'ask.scope-menu.all-selected': 'Alle',
    'ask.scope-menu.email': 'E-Mail',
    'ask.scope-menu.documents': 'Dokumente',
    'ask.scope-menu.documents-selected': 'Dok.',
    'ask.scope-menu.book-overview': 'Buchübersicht',
    'ask.scope-menu.book-selected': 'Buch',
    'ask.composer.placeholder-client': '{{name}} fragen',
    'ask.composer.placeholder-email': 'Zu importierten E-Mails fragen',
    'ask.composer.placeholder-documents': 'In deinen Dokumenten fragen',
    'ask.composer.placeholder-book': 'In gespeicherten Client Maps fragen',
    'ask.demo-intro.body': 'Antworten zitieren diese Dateien. Klicke auf ein Zitat, um die Quelle zu öffnen.',
    'ask.indexing.notice': 'Dokumente für zitierte Antworten indexieren.',
    'ask.indexing.enable': 'Aktivieren',
    'ask.file-access.prompt-title': 'KI-Dateizugriff für {{scopeLabel}} erlauben?',
    'ask.file-access.prompt-body': 'Sie kann Dateien suchen und lesen. Dateitext kann an {{provider}} gehen. Jede Bearbeitung fragt weiterhin zuerst.',
    'ask.file-access.reconfirm': 'Dieser Chat deckt jetzt {{scopeLabel}} ab und braucht deshalb erneut dein OK.',
    'ask.file-access.details-link': 'Details',
    'ask.file-access.details': 'Bis du es erlaubst, nutzt die KI nur das, was du eingibst, und Dateien, die du selbst öffnest oder anhängst.',
    'ask.file-access.allow': 'Erlauben',
    'ask.file-access.allow-all': 'Alle erlauben',
    'ask.file-access.not-now': 'Nicht jetzt',
    'ask.file-access.turn-off': 'Ausschalten',
    'ask.file-access.granted': 'Dateizugriff an. Bearbeitungen fragen weiterhin zuerst.',
    'ask.file-access.denied': 'Dateizugriff aus.',
    'ask.action.searching': 'Suchen',
    'ask.action.answering': 'Antworten',
    'ask.action.searching-documents': 'Deine Dokumente werden durchsucht',
    'ask.conversations.title': 'Unterhaltungen',
    'ask.conversations.show': 'Unterhaltungen anzeigen',
    'ask.conversations.hide': 'Unterhaltungen ausblenden',
    'ask.conversations.new-question': 'Neue Frage',
    'ask.conversations.new': 'Neu',
    'ask.sources.provenance-title': 'Dies ist ein exportierter Schnappschuss, keine Live-Verbindung.',
    'ask.sources.provenance-stale-title': 'Dieser exportierte Schnappschuss kann veraltet sein. Exportiere aus dem Tool erneut, um den neuesten Stand zu erhalten.',
    'ask.sources.provenance-stale-suffix': 'kann veraltet sein',
    'ask.sources.status.verified': 'Verifiziert',
    'ask.sources.status.found': 'Gefunden',
    'ask.sources.status.quote-not-found': 'Zitat nicht gefunden',
    'ask.sources.status.quote-mismatch': 'Zitat stimmt nicht überein',
    'ask.sources.status.wrong-client': 'Falscher Mandant',
    'ask.sources.status.could-not-verify': 'Konnte nicht verifiziert werden',
    'ask.sources.status.verified-title': 'Die gespeicherte Quelle wurde geprüft und enthält dieses genaue Zitat.',
    'ask.sources.status.checking-title': 'Dieses Zitat wird mit der gespeicherten Quelle geprüft.',
    'ask.sources.status.found-title': 'Diese Quelle wurde gefunden. Die automatische Prüfung konnte das genaue Zitat nicht bestätigen.',
    'ask.answer-scope.settings-label': 'Antworteinstellungen',
    'ask.answer-blocks.label.files': 'Dateien',
    'ask.answer-blocks.label.nothing-found': 'Keine Dateitreffer',
    'ask.answer-blocks.label.files-unverified': 'Gefunden, nicht verifiziert',
    'ask.answer-blocks.label.files-checking': 'Prüfung läuft',
    'ask.answer-blocks.label.general': 'Allgemein',
    'ask.answer-blocks.label.draft': 'Entwurf',
    'ask.answer-blocks.general-verifyline': 'Allgemeinwissen. Prüfe aktuelle Regeln.',
    'ask.answer-blocks.draft-note': 'Entwurf zur Prüfung vor dem Senden. Nichts wird automatisch gesendet.',
    'ask.answer-blocks.cited-attestation': 'Aus deinen Dateien zitiert. Öffne eine beliebige Nummer zur Prüfung.',
    'ask.answer-blocks.show-cited-files': 'Zitierte Dateien anzeigen',
    'ask.answer-blocks.nothing-found-note': 'Keine Dateitreffer. Allgemeine Hinweise sind markiert.',
    'ask.answer-blocks.tally.cited-claims_one': '1 Behauptung aus deinen Dateien zitiert',
    'ask.answer-blocks.tally.cited-claims_other': '{{count}} Behauptungen aus deinen Dateien zitiert',
    'ask.answer-blocks.tally.checking-sources_one': '1 Quelle wird geprüft',
    'ask.answer-blocks.tally.checking-sources_other': '{{count}} Quellen werden geprüft',
    'ask.answer-blocks.tally.sources-unverified_one': '1 Quelle gefunden, nicht verifiziert',
    'ask.answer-blocks.tally.sources-unverified_other': '{{count}} Quellen gefunden, nicht verifiziert',
    'ask.answer-blocks.tally.general': 'Allgemein',
    'ask.turn.view-ai-status': 'KI-Status anzeigen',
    'ask.turn.decline-note-client': 'In deinen Dateien wurde nichts gefunden. Versuche eine Frage zu diesem Mandanten.',
    'ask.turn.decline-note-all': 'In deinen Dateien wurde nichts gefunden. Versuche eine Frage zu deinen Mandanten.',
    'ask.turn.still-importing-decline': 'Import läuft noch. Versuche es nach Abschluss erneut.',
    'ask.turn.uncited-warning': 'Nicht aus deinen Dateien zitiert. Prüfe dies, bevor du dich darauf verlässt.',
    'ask.turn.stale-plan-warning': 'Verwendet alte Planexporte: {{exports}}. Exportiere erneut, um zu aktualisieren.',
    'ask.turn.stale-plan-age_one': '1 Tag alt',
    'ask.turn.stale-plan-age_other': '{{count}} Tage alt',
    'ask.turn.answer-actions': 'Antwortaktionen',
    'ask.turn.saving': 'Speichern',
    'ask.turn.save-to-doc': 'In Dokument speichern',
    'ask.turn.importing-banner': 'Dateien und E-Mails werden importiert. Antworten können unvollständig sein.',
    'ask.sample-bridge.dismiss': 'Schließen',
    'privacy.egress.local-pending.label': 'Lokale KI wird eingerichtet',
    'privacy.egress.local-pending.note': 'Deine KI auf dem Gerät wird noch heruntergeladen oder gestartet. Es wurde nichts irgendwohin gesendet. Prüfe den Fortschritt in den Einstellungen und versuche es dann erneut.',
    'privacy.retention.change': 'Ändern',
    'privacy.retention.more-actions': 'Weitere Aktionen für gelöschte Dateien',
    'meetings.notice-card.settings-advanced-summary': 'Erweiterter Aufnahmehinweis',
    'meetings.notice-card.settings-name-placeholder': 'Aufnahmehinweis - {advisor}',
  },
};

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function flattenLeaves(obj, prefix = '') {
  const out = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key.includes('__')) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    if (isObject(value)) Object.assign(out, flattenLeaves(value, path));
    else out[path] = value;
  }
  return out;
}

function getAtPath(obj, dottedPath) {
  let node = obj;
  for (const part of dottedPath.split('.')) {
    if (!isObject(node) || !(part in node)) return undefined;
    node = node[part];
  }
  return node;
}

function hasMissing(enNode, targetNode) {
  if (!isObject(enNode)) return targetNode === undefined;
  for (const [key, value] of Object.entries(enNode)) {
    if (key.includes('__')) continue;
    if (!isObject(targetNode) || !(key in targetNode)) return true;
    if (isObject(value) && hasMissing(value, targetNode[key])) return true;
  }
  return false;
}

function validatePlaceholders(enValue, translation, path, locale) {
  const placeholderPattern = /\{\{[^}]+\}\}|<[^>]+>|\{advisor\}/g;
  const source = enValue.match(placeholderPattern) ?? [];
  const target = translation.match(placeholderPattern) ?? [];
  if (source.join('|') !== target.join('|')) {
    throw new Error(
      `${locale}:${path} placeholder mismatch. Expected ${source.join(', ') || '(none)'}, got ${target.join(', ') || '(none)'}`,
    );
  }
  if (translation.includes('—')) {
    throw new Error(`${locale}:${path} contains an em dash.`);
  }
}

function buildMissingBranch(enNode, locale, prefix = '') {
  if (!isObject(enNode)) {
    const translation = translations[locale][prefix];
    if (typeof translation !== 'string') {
      throw new Error(`${locale}:${prefix} has no translation in the backfill table.`);
    }
    validatePlaceholders(enNode, translation, prefix, locale);
    return translation;
  }

  const out = {};
  for (const [key, value] of Object.entries(enNode)) {
    if (key.includes('__')) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    if (isObject(value)) {
      out[key] = buildMissingBranch(value, locale, path);
    } else {
      const translation = buildMissingBranch(value, locale, path);
      out[key] = translation;
      out[`${key}__sourceHash`] = sha256(value);
    }
  }
  return out;
}

function mergeLocale(enNode, targetNode, locale, prefix = '') {
  if (!hasMissing(enNode, targetNode)) return targetNode;
  if (!isObject(enNode)) return buildMissingBranch(enNode, locale, prefix);

  const out = {};
  const used = new Set();
  const target = isObject(targetNode) ? targetNode : {};

  for (const [key, value] of Object.entries(enNode)) {
    if (key.includes('__')) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    if (key in target) {
      out[key] = isObject(value) ? mergeLocale(value, target[key], locale, path) : target[key];
      used.add(key);
      for (const suffix of ['__sourceHash', '__locked']) {
        const metaKey = `${key}${suffix}`;
        if (metaKey in target) {
          out[metaKey] = target[metaKey];
          used.add(metaKey);
        }
      }
      continue;
    }

    if (isObject(value)) {
      out[key] = buildMissingBranch(value, locale, path);
    } else {
      const translation = buildMissingBranch(value, locale, path);
      out[key] = translation;
      out[`${key}__sourceHash`] = sha256(value);
    }
    used.add(key);
    used.add(`${key}__sourceHash`);
  }

  for (const key of Object.keys(target)) {
    if (!used.has(key)) out[key] = target[key];
  }

  return out;
}

function missingKeys(en, target) {
  return Object.keys(flattenLeaves(en)).filter((key) => getAtPath(target, key) === undefined);
}

function main() {
  const write = process.argv.includes('--write');
  const en = readJson(localePath('en'));
  const summary = {};

  for (const locale of ['es', 'de']) {
    const target = readJson(localePath(locale));
    const missing = missingKeys(en, target);
    summary[locale] = missing.length;
    console.log(`\n${locale}: ${missing.length} missing key(s)`);
    for (const key of missing) {
      const enValue = getAtPath(en, key);
      console.log(`- ${key}: ${JSON.stringify(enValue)}`);
      const translation = translations[locale][key];
      if (typeof translation !== 'string') {
        throw new Error(`${locale}:${key} missing from translation table.`);
      }
      validatePlaceholders(enValue, translation, key, locale);
    }

    if (write && missing.length > 0) {
      const next = mergeLocale(en, target, locale);
      writeJson(localePath(locale), next);
      console.log(`${locale}: wrote ${localePath(locale)}`);
    }
  }

  if (!write) {
    console.log('\nDry run only. Re-run with --write to backfill these translations.');
  } else {
    console.log(`\nBackfilled es=${summary.es}, de=${summary.de}.`);
  }
}

main();
