"use client";

import Script from "next/script";
import { useCallback, useEffect, useRef, useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

type LogEntry = {
  type: "ok" | "err" | "info";
  msg: string;
  time: string;
};

type BridgeResponse = {
  authCode?: string;
  authcode?: string;
  auth_code?: string;
  data?: {
    authCode?: string;
    authcode?: string;
    auth_code?: string;
  };
  errorMessage?: string;
  error?: string;
  [key: string]: unknown;
};

type BridgeCallOptions = {
  usage: string;
  scopes?: string[];
  success: (res: BridgeResponse) => void;
  fail: (res: BridgeResponse) => void;
};

type TokaAuthData = {
  userId: string;
  accessToken: string;
  tokenType: string;
  expiresIn: number;
  [key: string]: unknown;
};

declare global {
  interface Window {
    AlipayJSBridge?: {
      call: (method: string, options: BridgeCallOptions) => void;
    };
    my?: {
      call: (method: string, options: BridgeCallOptions) => void;
    };
  }
}

// ─── Extra scopes (on-demand, requieren consentimiento del usuario) ────────────

type ExtraScope = {
  id: string;
  method: string;
  label: string;
  icon: string;
  scopes: string[];
  description: string;
};

const EXTRA_SCOPES: ExtraScope[] = [
  {
    id: "contact",
    method: "ContactInformation",
    label: "Información de contacto",
    icon: "📱",
    scopes: ["PLAINTEXT_MOBILE_PHONE", "PLAINTEXT_EMAIL_ADDRESS"],
    description: "Teléfono y correo electrónico",
  },
  {
    id: "address",
    method: "AddressInformation",
    label: "Dirección",
    icon: "📍",
    scopes: ["USER_ADDRESS"],
    description: "Dirección del usuario",
  },
  {
    id: "personal",
    method: "PersonalInformation",
    label: "Datos personales",
    icon: "👤",
    scopes: [
      "USER_NAME",
      "USER_FIRST_SURNAME",
      "USER_SECOND_SURNAME",
      "USER_GENDER",
      "USER_BIRTHDAY",
    ],
    description: "Nombre completo, género y fecha de nacimiento",
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getTimestamp() {
  return new Date().toLocaleTimeString("es-MX", { hour12: false });
}

function isBridgeAvailable() {
  if (typeof window === "undefined") return false;
  return (
    typeof window.AlipayJSBridge?.call === "function" ||
    typeof window.my?.call === "function"
  );
}

function getBridge() {
  if (typeof window === "undefined") return null;
  if (typeof window.AlipayJSBridge?.call === "function")
    return window.AlipayJSBridge;
  if (typeof window.my?.call === "function") return window.my;
  return null;
}

function extractAuthCode(res: BridgeResponse): string {
  const code =
    res.authCode ??
    res.authcode ??
    res.auth_code ??
    res.data?.authCode ??
    res.data?.authcode ??
    res.data?.auth_code;
  return typeof code === "string" ? code.trim() : "";
}

function isPromiseLike(v: unknown): v is Promise<unknown> {
  return (
    typeof v === "object" &&
    v !== null &&
    "then" in v &&
    typeof (v as { then?: unknown }).then === "function"
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

type AuthState =
  | { status: "idle" }
  | { status: "waiting-bridge" }
  | { status: "authenticating" }
  | { status: "authenticated"; session: TokaAuthData; authCode: string }
  | { status: "error"; message: string };

export default function TokaApp() {
  // Estado de sesión principal
  const [authState, setAuthState] = useState<AuthState>({ status: "idle" });

  // Auth codes extra obtenidos on-demand
  const [extraCodes, setExtraCodes] = useState<Record<string, string>>({});
  const [extraLoading, setExtraLoading] = useState<string | null>(null);
  const [extraError, setExtraError] = useState<Record<string, string>>({});

  const [copied, setCopied] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const loginAttempted = useRef(false);

  const addLog = useCallback((type: LogEntry["type"], msg: string) => {
    setLogs((prev) => [{ type, msg, time: getTimestamp() }, ...prev].slice(0, 60));
  }, []);

  // ── Intercambia el authCode con Toka y guarda la sesión ─────────────────────
  const exchangeAuthCode = useCallback(
    async (code: string): Promise<TokaAuthData | null> => {
      setAuthState({ status: "authenticating" });
      addLog("info", "POST /api/toka/authenticate → canjeando authCode...");

      try {
        const res = await fetch("/api/toka/authenticate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ authcode: code }),
        });
        const payload = await res.json();

        if (!res.ok || !payload?.data?.accessToken) {
          throw new Error(payload?.message ?? `HTTP ${res.status}`);
        }

        addLog("ok", `Sesión iniciada — userId: ${payload.data.userId}`);
        return payload.data as TokaAuthData;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        addLog("err", `Error al canjear authCode: ${msg}`);
        return null;
      }
    },
    [addLog],
  );

  // ── Llama un JSAPI del bridge ────────────────────────────────────────────────
  const callBridge = useCallback(
    (method: string, scopes: string[]): Promise<string> => {
      return new Promise((resolve, reject) => {
        const bridge = getBridge();
        if (!bridge) {
          reject(new Error("AlipayJSBridge no disponible"));
          return;
        }

        const apiMethod = `getUser${method}AuthCode`;
        addLog("info", `Llamando ${apiMethod}...`);

        const timeout = window.setTimeout(() => {
          reject(new Error(`Timeout esperando respuesta de ${apiMethod}`));
        }, 12000);

        const done = (code?: string, errMsg?: string) => {
          window.clearTimeout(timeout);
          if (code) resolve(code);
          else reject(new Error(errMsg ?? "Sin authCode en respuesta"));
        };

        try {
          const result = bridge.call(apiMethod, {
            usage: method,
            scopes,
            success: (res) => {
              const code = extractAuthCode(res);
              if (code) done(code);
              else done(undefined, `Respuesta sin authCode: ${JSON.stringify(res)}`);
            },
            fail: (res) => {
              done(undefined, res.errorMessage ?? res.error ?? JSON.stringify(res));
            },
          });

          if (isPromiseLike(result)) {
            result
              .then((v) => {
                if (typeof v === "object" && v !== null) {
                  const code = extractAuthCode(v as BridgeResponse);
                  if (code) done(code);
                }
              })
              .catch((e) => {
                done(undefined, e instanceof Error ? e.message : String(e));
              });
          }
        } catch (e) {
          done(undefined, e instanceof Error ? e.message : String(e));
        }
      });
    },
    [addLog],
  );

  // ── LOGIN AUTOMÁTICO al montar — Digital Identity (USER_ID) ─────────────────
  const doAutoLogin = useCallback(async () => {
    if (loginAttempted.current) return;
    loginAttempted.current = true;

    if (!isBridgeAvailable()) {
      setAuthState({ status: "waiting-bridge" });
      addLog(
        "info",
        "Bridge no detectado aún. Esperando AlipayJSBridgeReady...",
      );
      return;
    }

    addLog("ok", "AlipayJSBridge detectado ✓ — iniciando autenticación...");

    try {
      const code = await callBridge("DigitalIdentity", [
        "USER_ID",
        "USER_AVATAR",
        "USER_NICKNAME",
      ]);

      addLog("ok", `DigitalIdentity authCode obtenido ✓`);
      const session = await exchangeAuthCode(code);

      if (session) {
        setAuthState({ status: "authenticated", session, authCode: code });
      } else {
        setAuthState({
          status: "error",
          message: "No se pudo intercambiar el authCode. Revisa el log.",
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setAuthState({ status: "error", message: msg });
      addLog("err", `Login automático falló: ${msg}`);
    }
  }, [addLog, callBridge, exchangeAuthCode]);

  // ── Escucha el bridge y dispara login ────────────────────────────────────────
  useEffect(() => {
    // Intento inmediato (ya podría estar listo)
    queueMicrotask(() => void doAutoLogin());

    // Evento estándar de Alipay
    const onReady = () => {
      addLog("ok", "AlipayJSBridgeReady event recibido ✓");
      void doAutoLogin();
    };
    document.addEventListener("AlipayJSBridgeReady", onReady);

    // Polling de fallback por si el evento no llega
    const poll = window.setInterval(() => {
      if (isBridgeAvailable() && authState.status === "waiting-bridge") {
        void doAutoLogin();
      }
    }, 500);

    return () => {
      document.removeEventListener("AlipayJSBridgeReady", onReady);
      window.clearInterval(poll);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Solicitar scope extra on-demand ──────────────────────────────────────────
  const requestExtraScope = useCallback(
    async (scope: ExtraScope) => {
      if (authState.status !== "authenticated") return;
      setExtraLoading(scope.id);
      setExtraError((prev) => ({ ...prev, [scope.id]: "" }));

      try {
        const code = await callBridge(scope.method, scope.scopes);
        setExtraCodes((prev) => ({ ...prev, [scope.id]: code }));
        addLog("ok", `[${scope.method}] authCode obtenido ✓`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setExtraError((prev) => ({ ...prev, [scope.id]: msg }));
        addLog("err", `[${scope.method}] falló: ${msg}`);
      } finally {
        setExtraLoading(null);
      }
    },
    [authState, callBridge, addLog],
  );

  const copyText = useCallback(async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, []);

  // ─── Render ─────────────────────────────────────────────────────────────────

  const isAuthenticated = authState.status === "authenticated";
  const session = isAuthenticated ? authState.session : null;

  return (
    <div style={s.page}>
      <Script
        src="https://cdn.marmot-cloud.com/npm/hylid-bridge/2.10.0/index.js"
        strategy="afterInteractive"
        onLoad={() => addLog("ok", "SDK hylid-bridge cargado ✓")}
        onError={() => addLog("err", "No se pudo cargar hylid-bridge SDK")}
      />

      {/* Header */}
      <div style={s.header}>
        <h1 style={s.title}>🔑 Toka Auth</h1>
        <p style={s.subtitle}>
          Autenticación automática via AlipayJSBridge al abrir la mini app.
        </p>
      </div>

      {/* Sesión principal */}
      <div
        style={{
          ...s.card,
          borderColor:
            authState.status === "authenticated"
              ? "#5eead480"
              : authState.status === "error"
                ? "#ef444480"
                : authState.status === "authenticating"
                  ? "#7c6df080"
                  : "#2a2d3e",
        }}
      >
        <div style={s.cardLabel}>
          <span>Sesión</span>
          <StatusBadge status={authState.status} />
        </div>

        {authState.status === "idle" && (
          <p style={{ ...s.muted, marginTop: 8 }}>Iniciando...</p>
        )}

        {authState.status === "waiting-bridge" && (
          <div style={{ marginTop: 8 }}>
            <p style={{ ...s.muted, color: "#f59e0b" }}>
              ⏳ Esperando AlipayJSBridge...
            </p>
            <p style={s.muted}>
              Abre esta página desde el WebView de Toka para que el bridge esté
              disponible.
            </p>
          </div>
        )}

        {authState.status === "authenticating" && (
          <p style={{ ...s.muted, color: "#7c6df0", marginTop: 8 }}>
            ⚡ Intercambiando authCode con{" "}
            <code style={s.code}>/v1/user/authenticate</code>...
          </p>
        )}

        {authState.status === "error" && (
          <p style={{ ...s.muted, color: "#ef4444", marginTop: 8 }}>
            ✕ {authState.message}
          </p>
        )}

        {authState.status === "authenticated" && session && (
          <div style={{ marginTop: 10, display: "grid", gap: 12 }}>
            <div style={s.metaGrid}>
              <MetaItem label="User ID" value={session.userId} />
              <MetaItem label="Token type" value={session.tokenType} />
              <MetaItem label="Expira en" value={`${session.expiresIn}s`} />
            </div>
            <div>
              <div style={s.metaLabel}>Access Token (JWT)</div>
              <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <p style={{ ...s.codeText, flex: 1 }}>{session.accessToken}</p>
                <button
                  style={{ ...s.copyBtn, ...(copied ? s.copyBtnDone : {}) }}
                  onClick={() => copyText(session.accessToken)}
                >
                  {copied ? "✅" : "📋"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Scopes extra — solo si ya está autenticado */}
      {isAuthenticated && (
        <div style={{ width: "100%", maxWidth: 600 }}>
          <div style={{ ...s.metaLabel, marginBottom: 10 }}>
            DATOS ADICIONALES (ON-DEMAND)
          </div>
          <p style={{ ...s.muted, marginBottom: 14, fontSize: 12 }}>
            Estos datos requieren consentimiento explícito del usuario. Solicítalos
            solo cuando los necesites.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {EXTRA_SCOPES.map((scope) => (
              <div key={scope.id} style={s.scopeCard}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span style={{ fontSize: 20 }}>{scope.icon}</span>
                  <div style={{ flex: 1 }}>
                    <div style={s.scopeLabel}>{scope.label}</div>
                    <div style={s.scopeDesc}>{scope.description}</div>
                  </div>
                  {extraCodes[scope.id] ? (
                    <span style={{ color: "#22c55e", fontSize: 12 }}>✓ Obtenido</span>
                  ) : (
                    <button
                      style={{
                        ...s.requestBtn,
                        opacity: extraLoading === scope.id ? 0.6 : 1,
                      }}
                      onClick={() => void requestExtraScope(scope)}
                      disabled={extraLoading !== null}
                    >
                      {extraLoading === scope.id ? (
                        <span style={s.spinner} />
                      ) : (
                        "Solicitar"
                      )}
                    </button>
                  )}
                </div>

                {extraCodes[scope.id] && (
                  <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid #2a2d3e" }}>
                    <div style={s.metaLabel}>authCode</div>
                    <p style={s.codeText}>{extraCodes[scope.id]}</p>
                  </div>
                )}

                {extraError[scope.id] && (
                  <p style={{ ...s.muted, color: "#ef4444", marginTop: 8, fontSize: 11 }}>
                    ✕ {extraError[scope.id]}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Log */}
      <div style={s.logSection}>
        <div style={s.metaLabel}>LOG DE LLAMADAS</div>
        <div style={s.logBox}>
          {logs.length === 0 ? (
            <span style={{ color: "#64748b", fontStyle: "italic" }}>
              Sin actividad...
            </span>
          ) : (
            logs.map((l, i) => (
              <div
                key={`${l.time}-${i}`}
                style={{ display: "flex", gap: 8, lineHeight: 1.8 }}
              >
                <span style={{ color: "#64748b", flexShrink: 0 }}>{l.time}</span>
                <span
                  style={{
                    color:
                      l.type === "ok"
                        ? "#22c55e"
                        : l.type === "err"
                          ? "#ef4444"
                          : "#7c6df0",
                  }}
                >
                  {l.msg}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: AuthState["status"] }) {
  const map: Record<AuthState["status"], { label: string; color: string; bg: string }> = {
    idle: { label: "Iniciando", color: "#64748b", bg: "rgba(100,116,139,.1)" },
    "waiting-bridge": { label: "Esperando bridge", color: "#f59e0b", bg: "rgba(245,158,11,.1)" },
    authenticating: { label: "Autenticando...", color: "#7c6df0", bg: "rgba(124,109,240,.1)" },
    authenticated: { label: "Autenticado ✓", color: "#5eead4", bg: "rgba(94,234,212,.1)" },
    error: { label: "Error", color: "#ef4444", bg: "rgba(239,68,68,.1)" },
  };
  const { label, color, bg } = map[status];
  return (
    <span
      style={{
        background: bg,
        color,
        border: `1px solid ${color}40`,
        borderRadius: 20,
        padding: "2px 10px",
        fontSize: 11,
        fontWeight: 600,
        fontFamily: "monospace",
      }}
    >
      {label}
    </span>
  );
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={s.metaLabel}>{label}</div>
      <div style={{ fontSize: 13, color: "#e2e8f0", wordBreak: "break-word" }}>{value}</div>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = {
  page: {
    background: "#0d0f14",
    color: "#e2e8f0",
    minHeight: "100vh",
    fontFamily: "'Inter', sans-serif",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    padding: "40px 20px",
    gap: 20,
  },
  header: { textAlign: "center" },
  title: { fontSize: 24, fontWeight: 700, marginBottom: 6 },
  subtitle: { fontSize: 13, color: "#64748b", maxWidth: 420, lineHeight: 1.6 },
  card: {
    width: "100%",
    maxWidth: 600,
    background: "#161820",
    border: "2px solid",
    borderRadius: 16,
    padding: "18px 20px",
    transition: "border-color .3s",
  },
  cardLabel: {
    fontSize: 11,
    fontWeight: 600,
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: ".8px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  metaGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
    gap: 12,
  },
  metaLabel: {
    fontSize: 11,
    fontWeight: 600,
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: ".8px",
    marginBottom: 4,
  },
  codeText: {
    fontFamily: "monospace",
    fontSize: 12,
    color: "#5eead4",
    wordBreak: "break-all",
    lineHeight: 1.6,
    margin: 0,
  },
  code: {
    fontFamily: "monospace",
    fontSize: 12,
    color: "#7c6df0",
  },
  muted: {
    fontSize: 13,
    color: "#64748b",
    lineHeight: 1.6,
    margin: 0,
  },
  copyBtn: {
    background: "rgba(94,234,212,.08)",
    border: "1px solid rgba(94,234,212,.2)",
    color: "#5eead4",
    borderRadius: 6,
    padding: "4px 10px",
    fontSize: 13,
    cursor: "pointer",
    flexShrink: 0,
  },
  copyBtnDone: {
    background: "rgba(34,197,94,.1)",
    borderColor: "rgba(34,197,94,.4)",
    color: "#22c55e",
  },
  scopeCard: {
    background: "#161820",
    border: "1px solid #2a2d3e",
    borderRadius: 12,
    padding: "14px 16px",
  },
  scopeLabel: { fontSize: 14, fontWeight: 500, marginBottom: 2 },
  scopeDesc: { fontSize: 11, color: "#64748b", fontFamily: "monospace" },
  requestBtn: {
    background: "rgba(124,109,240,.15)",
    border: "1px solid rgba(124,109,240,.3)",
    color: "#7c6df0",
    borderRadius: 8,
    padding: "6px 14px",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: 6,
    flexShrink: 0,
  },
  spinner: {
    display: "inline-block",
    width: 14,
    height: 14,
    border: "2px solid rgba(124,109,240,.2)",
    borderTopColor: "#7c6df0",
    borderRadius: "50%",
    animation: "spin .7s linear infinite",
  },
  logSection: { width: "100%", maxWidth: 600 },
  logBox: {
    background: "#161820",
    border: "1px solid #2a2d3e",
    borderRadius: 10,
    padding: "12px 14px",
    fontFamily: "monospace",
    fontSize: 11,
    maxHeight: 200,
    overflowY: "auto",
    lineHeight: 1.8,
    marginTop: 8,
  },
} as const;
