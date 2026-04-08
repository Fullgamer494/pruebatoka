"use client";

import Script from "next/script";
import { useState, useCallback, useEffect } from "react";

export default function Home() {
  const [logs, setLogs] = useState<string[]>([]);
  const [authCode, setAuthCode] = useState<string>("");
  const [jwt, setJwt] = useState<string>("");

  const addLog = (msg: string) => {
    setLogs((prev) => [...prev, `${new Date().toLocaleTimeString()} - ${msg}`]);
  };

  const getBridge = () => {
    // Definimos los tipos aquí de manera rústica para mantenerlo simple.
    const w = window as any;
    if (typeof window !== "undefined" && w.AlipayJSBridge) {
      return w.AlipayJSBridge;
    }
    return null;
  };

  const authenticateWithServer = async (code: string) => {
    addLog(`Enviando authCode al backend (/api/toka/authenticate)...`);
    try {
      const res = await fetch("/api/toka/authenticate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authcode: code }),
      });
      const data = await res.json();

      if (res.ok && data.success && data.data?.accessToken) {
        addLog(`JWT Obtenido exitosamente ✓`);
        setJwt(data.data.accessToken);
      } else {
        addLog(`Respuesta del servidor: ${JSON.stringify(data)}`);
      }
    } catch (e) {
      addLog(`Error en fetch: ${(e as Error).message}`);
    }
  };

  const requestAuthCode = useCallback(() => {
    const bridge = getBridge();
    if (!bridge) {
      addLog("AlipayJSBridge no está disponible. Abre esta app desde Toka.");
      return;
    }

    addLog("Llamando a getUserDigitalIdentityAuthCode...");

    // Se inyecta obligatoriamente el appId para H5 y se lee el código desde res.result
    // En H5, el callback de éxito/falla siempre debe enviarse como 3er parámetro a la función call
    // a diferencia de en Nativo donde va adentro del objeto
    bridge.call('getUserDigitalIdentityAuthCode', {
      appId: process.env.NEXT_PUBLIC_TOKA_APP_ID || '3500020265479238',
      usage: 'Autenticación inicial de la Mini App',
      scopes: ['USER_ID', 'USER_AVATAR', 'USER_NICKNAME']
    }, (res: any) => {
      // Validamos si la respuesta vino con un error
      if (res.error || res.errorMessage || (res.resultCode && res.resultCode !== 10000)) {
        addLog(`Fail - Error: ${JSON.stringify(res)}`);
      } else {
        addLog(`Success - Respuesta: ${JSON.stringify(res)}`);
        
        // En Toka H5, el código viene en la propiedad "result" en lugar de "authCode"
        const code = res.result || res.authcode || res.authCode;
        if (code) {
          setAuthCode(code);
          authenticateWithServer(code);
        } else {
          addLog("AuthCode no encontrado en la respuesta (res.result está vacío).");
        }
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onBridgeReady = () => {
      addLog("AlipayJSBridge Detectado y Listo ✓");
    };
    document.addEventListener("AlipayJSBridgeReady", onBridgeReady);

    // Verificamos si ya estaba listo al cargar
    if (getBridge()) {
      onBridgeReady();
    }

    return () => document.removeEventListener("AlipayJSBridgeReady", onBridgeReady);
  }, []);

  return (
    <div style={{ padding: 20, fontFamily: "sans-serif", maxWidth: 600, margin: "0 auto", background: "#f9f9f9", minHeight: "100vh", color: "#333" }}>
      {/* Importamos el SDK de miniapps H5 */}
      <Script
        src="https://cdn.marmot-cloud.com/npm/hylid-bridge/2.10.0/index.js"
        strategy="beforeInteractive"
        onLoad={() => addLog("SDK hylid-bridge Cargado ✓")}
      />

      <h1 style={{ fontSize: 24, marginBottom: 10 }}>Autenticación Toka Minimal</h1>
      <p style={{ fontSize: 14, color: "#666", marginBottom: 20 }}>
        Flujo básico y esencial de obtención de AuthCode e intercambio por JWT.
      </p>

      <button
        onClick={requestAuthCode}
        style={{ width: '100%', padding: '12px 20px', fontSize: 16, cursor: 'pointer', background: '#4F46E5', color: 'white', border: 'none', borderRadius: 8, marginBottom: 20, fontWeight: 'bold' }}
      >
        Obtener AuthCode y JWT
      </button>

      {authCode && (
        <div style={{ background: '#E0E7FF', padding: 15, borderRadius: 8, marginBottom: 15, border: '1px solid #C7D2FE' }}>
          <strong style={{ display: 'block', marginBottom: 5, color: '#3730A3' }}>AuthCode:</strong>
          <code style={{ wordBreak: 'break-all' }}>{authCode}</code>
        </div>
      )}

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
