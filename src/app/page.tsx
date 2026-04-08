"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type AuthMethod = {
  id: string;
  method: string;
  label: string;
  icon: string;
  scopes: string[];
};

type LogEntry = {
  type: "ok" | "err" | "info";
  msg: string;
  time: string;
};

type BridgeResponse = {
  authCode?: string;
  auth_code?: string;
  errorMessage?: string;
  error?: string;
  [key: string]: unknown;
};

type BridgeCallOptions = {
  usage: string;
  scopes: string[];
  success: (res: BridgeResponse) => void;
  fail: (res: BridgeResponse) => void;
};

declare global {
  interface Window {
    AlipayJSBridge?: {
      call: (method: string, options: BridgeCallOptions) => void;
    };
  }
}

const AUTH_METHODS: AuthMethod[] = [
  {
    id: "digital",
    method: "DigitalIdentity",
    label: "Digital Identity",
    icon: "🪪",
    scopes: ["USER_ID", "USER_AVATAR", "USER_NICKNAME"],
  },
  {
    id: "contact",
    method: "ContactInformation",
    label: "Contact Information",
    icon: "📱",
    scopes: ["PLAINTEXT_MOBILE_PHONE", "PLAINTEXT_EMAIL_ADDRESS"],
  },
  {
    id: "address",
    method: "AddressInformation",
    label: "Address Information",
    icon: "📍",
    scopes: ["USER_ADDRESS"],
  },
  {
    id: "personal",
    method: "PersonalInformation",
    label: "Personal Information",
    icon: "👤",
    scopes: [
      "USER_NAME",
      "USER_FIRST_SURNAME",
      "USER_SECOND_SURNAME",
      "USER_GENDER",
      "USER_BIRTHDAY",
      "USER_STATE_OF_BIRTH",
      "USER_NATIONALITY",
    ],
  },
  {
    id: "kyc",
    method: "KYCStatus",
    label: "KYC Status",
    icon: "✅",
    scopes: ["USER_KYC_STATUS"],
  },
];

function getTimestamp() {
  return new Date().toLocaleTimeString("es-MX", { hour12: false });
}

function isBridgeAvailable() {
  return typeof window !== "undefined" && typeof window.AlipayJSBridge !== "undefined";
}

export default function AuthCodeGenerator() {
  const [bridgeReady, setBridgeReady] = useState(() => isBridgeAvailable());
  const [authCode, setAuthCode] = useState("");
  const [error, setError] = useState("");
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>(() => [
    { type: "info", msg: "Buscando AlipayJSBridge...", time: getTimestamp() },
  ]);
  const requestTimeoutRef = useRef<number | null>(null);

  const addLog = useCallback((type: LogEntry["type"], msg: string) => {
    setLogs((prev) => [{ type, msg, time: getTimestamp() }, ...prev].slice(0, 50));
  }, []);

  useEffect(() => {
    let cancelled = false;
    let reportedReady = false;

    const markReady = (message: string) => {
      if (cancelled || reportedReady) {
        return;
      }

      reportedReady = true;
      setBridgeReady(true);
      addLog("ok", message);
    };

    queueMicrotask(() => {
      if (isBridgeAvailable()) {
        markReady("AlipayJSBridge detectado ✓ — listo para usar");
      }
    });

    const onBridgeReady = () => markReady("AlipayJSBridgeReady event recibido ✓");
    document.addEventListener("AlipayJSBridgeReady", onBridgeReady);

    const pollId = window.setInterval(() => {
      if (isBridgeAvailable()) {
        markReady("AlipayJSBridge detectado por polling ✓");
      }
    }, 300);

    const warningId = window.setTimeout(() => {
      if (!cancelled && !reportedReady) {
        addLog(
          "err",
          "Sigue sin aparecer AlipayJSBridge. Si estás en Toka, recarga la vista o revisa que el bridge esté expuesto.",
        );
      }
    }, 8000);

    return () => {
      cancelled = true;
      document.removeEventListener("AlipayJSBridgeReady", onBridgeReady);
      window.clearInterval(pollId);
      window.clearTimeout(warningId);
    };
  }, [addLog]);

  const callMethod = useCallback(
    ({ method, scopes, id }: AuthMethod) => {
      if (requestTimeoutRef.current !== null) {
        window.clearTimeout(requestTimeoutRef.current);
        requestTimeoutRef.current = null;
      }

      if (!isBridgeAvailable()) {
        const msg =
          "AlipayJSBridge no disponible. Abre esta página desde el WebView de Toka.";
        setError(msg);
        setAuthCode("");
        addLog("err", msg);
        return;
      }

      setLoadingId(id);
      setError("");
      setAuthCode("");
      addLog("info", `Llamando getUser${method}AuthCode...`);

      requestTimeoutRef.current = window.setTimeout(() => {
        requestTimeoutRef.current = null;
        setLoadingId(null);
        const msg = `Tiempo de espera agotado para ${method}. El bridge no respondió con success/fail.`;
        setError(msg);
        addLog("err", msg);
      }, 12000);

      try {
        const bridge = window.AlipayJSBridge;

        if (!bridge) {
          const msg = "AlipayJSBridge no disponible en este entorno.";
          setError(msg);
          setLoadingId(null);
          if (requestTimeoutRef.current !== null) {
            window.clearTimeout(requestTimeoutRef.current);
            requestTimeoutRef.current = null;
          }
          addLog("err", msg);
          return;
        }

        bridge.call(`getUser${method}AuthCode`, {
          usage: "Toka — prueba de integración",
          scopes,
          success(res) {
            if (requestTimeoutRef.current !== null) {
              window.clearTimeout(requestTimeoutRef.current);
              requestTimeoutRef.current = null;
            }

            const code = res.authCode ?? res.auth_code ?? JSON.stringify(res);
            setAuthCode(code);
            setLoadingId(null);
            addLog("ok", `[${method}] authCode: ${code.slice(0, 24)}...`);
          },
          fail(res) {
            if (requestTimeoutRef.current !== null) {
              window.clearTimeout(requestTimeoutRef.current);
              requestTimeoutRef.current = null;
            }

            const msg = res.errorMessage ?? res.error ?? JSON.stringify(res);
            setError(`Error en ${method}: ${msg}`);
            setLoadingId(null);
            addLog("err", `[${method}] fail: ${msg}`);
          },
        });
      } catch (caughtError) {
        if (requestTimeoutRef.current !== null) {
          window.clearTimeout(requestTimeoutRef.current);
          requestTimeoutRef.current = null;
        }

        const msg = caughtError instanceof Error ? caughtError.message : String(caughtError);
        setError(`Excepción: ${msg}`);
        setLoadingId(null);
        addLog("err", `Excepción: ${msg}`);
      }
    },
    [addLog],
  );

  const copyCode = useCallback(async () => {
    if (!authCode) {
      return;
    }

    await navigator.clipboard.writeText(authCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [authCode]);

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.title}>🔑 AuthCode Generator</h1>
        <p style={styles.subtitle}>
          Llama los JSAPIs de Toka/Alipay directamente desde el bridge del WebView.
        </p>
        <span
          style={{
            ...styles.badge,
            ...(bridgeReady ? styles.badgeReady : styles.badgeWait),
          }}
        >
          <span
            style={{
              ...styles.dot,
              background: bridgeReady ? "#5eead4" : "#f59e0b",
            }}
          />
          {bridgeReady ? "AlipayJSBridge listo" : "Esperando bridge..."}
        </span>
      </div>

      <div
        style={{
          ...styles.resultBox,
          borderColor: authCode ? "#5eead4" : error ? "#ef4444" : "#2a2d3e",
        }}
      >
        <div style={styles.resultLabel}>
          <span>AuthCode</span>
          {authCode ? (
            <button
              style={{ ...styles.copyBtn, ...(copied ? styles.copyBtnDone : {}) }}
              onClick={copyCode}
            >
              {copied ? "✅ Copiado" : "📋 Copiar"}
            </button>
          ) : null}
        </div>
        {authCode ? (
          <p style={styles.codeText}>{authCode}</p>
        ) : error ? (
          <p style={{ ...styles.codeText, color: "#ef4444", fontSize: 13 }}>✕ {error}</p>
        ) : (
          <p style={{ ...styles.codeText, color: "#64748b", fontFamily: "inherit", fontSize: 13 }}>
            Selecciona un método abajo para obtener tu authCode →
          </p>
        )}
      </div>

      <div style={styles.methods}>
        {AUTH_METHODS.map((item) => (
          <button
            key={item.id}
            style={{
              ...styles.card,
              ...(loadingId === item.id ? styles.cardLoading : {}),
            }}
            onClick={() => callMethod(item)}
            disabled={loadingId !== null}
          >
            <span style={{ fontSize: 22 }}>{item.icon}</span>
            <div style={{ flex: 1, textAlign: "left" }}>
              <div style={styles.cardName}>
                getUser<strong>{item.method}</strong>AuthCode
              </div>
              <div style={styles.cardScopes}>{item.scopes.join(" · ")}</div>
            </div>
            {loadingId === item.id ? (
              <span style={styles.spinner} />
            ) : (
              <span style={{ color: "#64748b", fontSize: 20 }}>›</span>
            )}
          </button>
        ))}
      </div>

      <div style={styles.warning}>
        <strong>⚠️ Solo funciona dentro del WebView de Toka</strong>
        <br />
        En un navegador normal, <code>AlipayJSBridge</code> no estará disponible. Si el estado se
        queda esperando, recarga la vista de Toka y confirma que el bridge esté expuesto.
      </div>

      <div style={styles.logSection}>
        <div style={styles.logTitle}>Log de llamadas</div>
        <div style={styles.logBox}>
          {logs.length === 0 ? (
            <span style={{ color: "#64748b", fontStyle: "italic", fontSize: 11 }}>
              Sin actividad...
            </span>
          ) : (
            logs.map((logEntry, index) => (
              <div key={`${logEntry.time}-${index}`} style={{ display: "flex", gap: 8, lineHeight: 1.8 }}>
                <span style={{ color: "#64748b", flexShrink: 0 }}>{logEntry.time}</span>
                <span
                  style={{
                    color:
                      logEntry.type === "ok"
                        ? "#22c55e"
                        : logEntry.type === "err"
                          ? "#ef4444"
                          : "#7c6df0",
                  }}
                >
                  {logEntry.msg}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

const styles = {
  page: {
    background: "#0d0f14",
    color: "#e2e8f0",
    minHeight: "100vh",
    fontFamily: "'Inter', sans-serif",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    padding: "40px 20px",
  },
  header: { textAlign: "center", marginBottom: 32 },
  title: { fontSize: 24, fontWeight: 700, marginBottom: 6 },
  subtitle: { fontSize: 14, color: "#64748b", maxWidth: 420, lineHeight: 1.6 },
  badge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    borderRadius: 20,
    padding: "4px 12px",
    fontSize: 11,
    fontFamily: "monospace",
    marginTop: 12,
    border: "1px solid",
  },
  badgeReady: { background: "rgba(94,234,212,.1)", borderColor: "rgba(94,234,212,.3)", color: "#5eead4" },
  badgeWait: { background: "rgba(245,158,11,.1)", borderColor: "rgba(245,158,11,.3)", color: "#f59e0b" },
  dot: { width: 6, height: 6, borderRadius: "50%" },
  resultBox: {
    width: "100%",
    maxWidth: 600,
    background: "#161820",
    border: "2px solid",
    borderRadius: 16,
    padding: "18px 20px",
    marginBottom: 24,
    transition: "border-color .3s",
  },
  resultLabel: {
    fontSize: 11,
    fontWeight: 600,
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: ".8px",
    marginBottom: 10,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  codeText: {
    fontFamily: "monospace",
    fontSize: 15,
    color: "#5eead4",
    wordBreak: "break-all",
    lineHeight: 1.6,
  },
  copyBtn: {
    background: "rgba(94,234,212,.1)",
    border: "1px solid rgba(94,234,212,.25)",
    color: "#5eead4",
    borderRadius: 6,
    padding: "3px 10px",
    fontSize: 11,
    fontWeight: 600,
    cursor: "pointer",
  },
  copyBtnDone: {
    background: "rgba(34,197,94,.1)",
    borderColor: "rgba(34,197,94,.4)",
    color: "#22c55e",
  },
  methods: { width: "100%", maxWidth: 600, display: "flex", flexDirection: "column", gap: 10 },
  card: {
    background: "#161820",
    border: "1px solid #2a2d3e",
    borderRadius: 12,
    padding: "14px 18px",
    display: "flex",
    alignItems: "center",
    gap: 14,
    cursor: "pointer",
    transition: "all .15s",
    width: "100%",
    color: "#e2e8f0",
    fontFamily: "'Inter', sans-serif",
  },
  cardLoading: { borderColor: "#7c6df0", opacity: 0.8 },
  cardName: { fontSize: 14, fontWeight: 500, marginBottom: 2 },
  cardScopes: { fontSize: 11, color: "#64748b", fontFamily: "monospace", lineHeight: 1.5 },
  spinner: {
    display: "inline-block",
    width: 18,
    height: 18,
    flexShrink: 0,
    border: "2px solid rgba(124,109,240,.2)",
    borderTopColor: "#7c6df0",
    borderRadius: "50%",
    animation: "spin .7s linear infinite",
  },
  warning: {
    width: "100%",
    maxWidth: 600,
    background: "rgba(245,158,11,.06)",
    border: "1px solid rgba(245,158,11,.2)",
    borderRadius: 10,
    padding: "14px 16px",
    fontSize: 12.5,
    color: "#fbbf24",
    lineHeight: 1.7,
    marginTop: 20,
  },
  logSection: { width: "100%", maxWidth: 600, marginTop: 20 },
  logTitle: {
    fontSize: 11,
    fontWeight: 600,
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: ".8px",
    marginBottom: 8,
  },
  logBox: {
    background: "#161820",
    border: "1px solid #2a2d3e",
    borderRadius: 10,
    padding: "12px 14px",
    fontFamily: "monospace",
    fontSize: 11.5,
    maxHeight: 180,
    overflowY: "auto",
    lineHeight: 1.8,
  },
} as const;
