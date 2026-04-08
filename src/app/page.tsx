"use client";

import Script from "next/script";
import { useState, useEffect } from "react";

export default function Home() {
  const [logs, setLogs] = useState<string[]>([]);
  const [authCode, setAuthCode] = useState<string>("");
  const [jwt, setJwt] = useState<string>("");

  const addLog = (msg: string) => {
    setLogs((prev) => [...prev, `${new Date().toLocaleTimeString()} - ${msg}`]);
  };

  const APP_ID = process.env.NEXT_PUBLIC_TOKA_APP_ID || '3500020265479238';

  const getBridge = () => {
    const w = window as any;
    if (typeof window !== "undefined" && w.AlipayJSBridge) {
      return w.AlipayJSBridge;
    }
    return null;
  };

  const getAuthCode = (method: string, scopes: string[]) => {
    const bridge = getBridge();
    if (!bridge) {
      addLog("AlipayJSBridge no está disponible. Abre esta app desde Toka.");
      return;
    }

    addLog(`Llamando a getUser${method}AuthCode...`);
    
    let respondio = false;
    let to = setTimeout(() => {
      if (!respondio) addLog(`TIMEOUT (Colgado): ${method}`);
    }, 4000);

    bridge.call(`getUser${method}AuthCode`, {
      appId: APP_ID,
      usage: `Autorización para ${method}`,
      scopes: scopes
    }, (res: any) => {
      respondio = true;
      clearTimeout(to);

      if (res.error || res.errorMessage || (res.resultCode && res.resultCode !== 10000)) {
        addLog(`Fail ${method} - Error: ${JSON.stringify(res)}`);
      } else {
        const code = res.result || res.authcode || res.authCode || JSON.stringify(res);
        addLog(`Success ${method} - AuthCode obtenido: ${code}`);
        setAuthCode(code);
      }
    });
  };

  const authenticateWithServer = async () => {
    if (!authCode) {
      addLog("⚠️ Cuidado: No hay un AuthCode seleccionado o generado para enviar.");
      return;
    }
    
    addLog(`Enviando authCode (${authCode}) al backend (/api/toka/authenticate)...`);
    try {
      const res = await fetch("/api/toka/authenticate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authcode: authCode }),
      });
      const data = await res.json();

      if (res.ok && data.success && data.data?.accessToken) {
        addLog(`🎉 JWT Obtenido exitosamente ✓`);
        setJwt(data.data.accessToken);
      } else {
        addLog(`❌ Respuesta del servidor: ${JSON.stringify(data)}`);
      }
    } catch (e) {
      addLog(`❌ Error en fetch: ${(e as Error).message}`);
    }
  };

  useEffect(() => {
    const onBridgeReady = () => {
      addLog("AlipayJSBridge Detectado y Listo ✓");
    };
    document.addEventListener("AlipayJSBridgeReady", onBridgeReady);

    if (getBridge()) {
      onBridgeReady();
    }

    return () => document.removeEventListener("AlipayJSBridgeReady", onBridgeReady);
  }, []);

  return (
    <div style={{ padding: 20, fontFamily: "sans-serif", maxWidth: 600, margin: "0 auto", background: "#f9f9f9", minHeight: "100vh", color: "#333" }}>
      <Script
        src="https://cdn.marmot-cloud.com/npm/hylid-bridge/2.10.0/index.js"
        strategy="beforeInteractive"
        onLoad={() => addLog("SDK hylid-bridge Cargado ✓")}
      />

      <h1 style={{ fontSize: 24, marginBottom: 10 }}>Autenticación Toka Minimal</h1>
      <p style={{ fontSize: 14, color: "#666", marginBottom: 20 }}>
        Paso 1: Obtén un código usando cualquiera de los 5 botones. <br/>
        Paso 2: Canjea el código obtenido por el JWT en nuestro Backend.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "20px" }}>
        <button onClick={() => getAuthCode('DigitalIdentity', ['USER_ID', 'USER_AVATAR', 'USER_NICKNAME'])} style={btnStyle}>
          1. GET Digital Identity AuthCode
        </button>
        <button onClick={() => getAuthCode('ContactInformation', ['PLAINTEXT_MOBILE_PHONE', 'PLAINTEXT_EMAIL_ADDRESS'])} style={btnStyle}>
          2. GET Contact Info AuthCode
        </button>
        <button onClick={() => getAuthCode('AddressInformation', ['USER_ADDRESS'])} style={btnStyle}>
          3. GET Address Info AuthCode
        </button>
        <button onClick={() => getAuthCode('PersonalInformation', ['USER_NAME', 'USER_FIRST_SURNAME', 'USER_SECOND_SURNAME', 'USER_GENDER', 'USER_BIRTHDAY', 'USER_STATE_OF_BIRTH', 'USER_NATIONALITY'])} style={btnStyle}>
          4. GET Personal Info AuthCode
        </button>
        <button onClick={() => getAuthCode('KYCStatus', ['USER_KYC_STATUS'])} style={btnStyle}>
          5. GET KYC Status AuthCode
        </button>
      </div>

      <div style={{ background: '#E0E7FF', padding: 15, borderRadius: 8, marginBottom: 15, border: '1px solid #C7D2FE' }}>
        <strong style={{ display: 'block', marginBottom: 5, color: '#3730A3' }}>AuthCode Preparado:</strong>
        <code style={{ wordBreak: 'break-all', fontSize: 16 }}>{authCode || "Ninguno generado aún"}</code>
      </div>

      <button
        onClick={authenticateWithServer}
        style={{ width: '100%', padding: '12px 20px', fontSize: 16, cursor: 'pointer', background: '#10B981', color: 'white', border: 'none', borderRadius: 8, marginBottom: 20, fontWeight: 'bold' }}
      >
        CANJEAR AUTHCODE EN BACKEND
      </button>

      {jwt && (
        <div style={{ background: '#DCFCE7', padding: 15, borderRadius: 8, marginBottom: 15, border: '1px solid #BBF7D0' }}>
          <strong style={{ display: 'block', marginBottom: 5, color: '#166534' }}>JWT (AccessToken):</strong>
          <code style={{ wordBreak: 'break-all', fontSize: 12 }}>{jwt}</code>
        </div>
      )}

      <div style={{ background: '#1E293B', color: '#10B981', padding: 15, borderRadius: 8, minHeight: 250, fontFamily: 'monospace', fontSize: 12, overflowY: 'auto' }}>
        <strong style={{ display: 'block', marginBottom: 10, color: '#94A3B8' }}>LOG DE EVENTOS:</strong>
        {logs.length === 0 ? <span style={{ color: '#64748B' }}>Sin actividad...</span> : null}
        {logs.map((log, i) => (
          <div key={i} style={{ marginBottom: 4 }}>{log}</div>
        ))}
      </div>
    </div>
  );
}

const btnStyle = { padding: '10px 15px', fontSize: 14, cursor: 'pointer', background: '#4F46E5', color: 'white', border: 'none', borderRadius: 5 };
