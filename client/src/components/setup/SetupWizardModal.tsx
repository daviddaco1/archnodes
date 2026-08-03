import { useEffect, useState } from "react";
import * as api from "../../api/client";
import type { Template } from "../../api/client";
import styles from "./SetupWizardModal.module.css";

interface SetupWizardModalProps {
  onClose: () => void;
  onApplied: () => void;
}

type Mode = "templates" | "manual";

export function SetupWizardModal({ onClose, onApplied }: SetupWizardModalProps) {
  const [mode, setMode] = useState<Mode>("templates");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [languages, setLanguages] = useState<string[]>([]);
  const [frameworks, setFrameworks] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [language, setLanguage] = useState("TypeScript");
  const [framework, setFramework] = useState("");
  const [database, setDatabase] = useState("");
  const [architecture, setArchitecture] = useState<"monolith" | "microservices">("monolith");
  const [domains, setDomains] = useState("");

  useEffect(() => {
    api.getTemplates().then(setTemplates).catch((err) => setError(String(err)));
    api.getSuggestedLanguages().then((r) => setLanguages(r.languages)).catch(() => {});
  }, []);

  useEffect(() => {
    api
      .getSuggestedFrameworks(language)
      .then((r) => {
        setFrameworks(r.frameworks);
        if (r.frameworks.length > 0) setFramework((prev) => (r.frameworks.includes(prev) ? prev : r.frameworks[0]));
      })
      .catch(() => {});
  }, [language]);

  useEffect(() => {
    if (!framework) return;
    api
      .getSuggestedStack(framework)
      .then((stack) => {
        if (stack.database) setDatabase(stack.database);
      })
      .catch(() => {});
  }, [framework]);

  const handleApplyTemplate = async (templateId: string) => {
    setBusy(true);
    setError(null);
    try {
      await api.applyTemplate(templateId);
      onApplied();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleApplyManual = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.applyWizard({
        language,
        framework,
        database,
        architecture,
        domains: domains.split(",").map((d) => d.trim()).filter(Boolean),
      });
      onApplied();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={`card ${styles.modal}`} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 style={{ margin: 0 }}>Setup del proyecto</h2>
          <button className="btn-icon" onClick={onClose}>
            ×
          </button>
        </div>

        <div className={styles.modeSwitch}>
          <button className={`btn-secondary ${styles.modeBtn} ${mode === "templates" ? styles.active : ""}`} onClick={() => setMode("templates")}>
            Plantilla
          </button>
          <button className={`btn-secondary ${styles.modeBtn} ${mode === "manual" ? styles.active : ""}`} onClick={() => setMode("manual")}>
            Manual
          </button>
        </div>

        {error && <p style={{ color: "var(--color-danger)", fontSize: 12 }}>{error}</p>}

        {mode === "templates" ? (
          <div className={styles.templateGrid}>
            {templates.map((t) => (
              <div key={t.id} className={styles.templateCard} onClick={() => !busy && void handleApplyTemplate(t.id)}>
                <div className={styles.templateLabel}>{t.label}</div>
                <div className={styles.templateDescription}>{t.description}</div>
                <div className={styles.templateBadges}>
                  <span className="badge">{t.language}</span>
                  <span className="badge">{t.framework}</span>
                  <span className="badge">{t.database}</span>
                  {t.frontendFramework && <span className="badge">{t.frontendFramework}</span>}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div>
            <div className={styles.formGrid}>
              <div>
                <label>Lenguaje</label>
                <select value={language} onChange={(e) => setLanguage(e.target.value)}>
                  {languages.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label>Framework</label>
                <input list="framework-suggestions" value={framework} onChange={(e) => setFramework(e.target.value)} />
                <datalist id="framework-suggestions">
                  {frameworks.map((f) => (
                    <option key={f} value={f} />
                  ))}
                </datalist>
              </div>
              <div>
                <label>Base de datos</label>
                <input value={database} onChange={(e) => setDatabase(e.target.value)} />
              </div>
              <div>
                <label>Arquitectura</label>
                <select value={architecture} onChange={(e) => setArchitecture(e.target.value as "monolith" | "microservices")}>
                  <option value="monolith">Monolito</option>
                  <option value="microservices">Microservicios</option>
                </select>
              </div>
              <div className={styles.fieldFull}>
                <label>Dominios (separados por coma, opcional)</label>
                <input value={domains} onChange={(e) => setDomains(e.target.value)} placeholder="Auth, Billing, Catalog" />
              </div>
            </div>
            <button className="btn-primary" style={{ marginTop: 16 }} disabled={busy} onClick={() => void handleApplyManual()}>
              Aplicar
            </button>
          </div>
        )}

        <div className={styles.skip}>
          <button className="btn-icon" onClick={onClose}>
            Empezar vacío / hacerlo a mano
          </button>
        </div>
      </div>
    </div>
  );
}
