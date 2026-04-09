"use client";

import Script from "next/script";
import { useState, useEffect } from "react";

type Subscription = {
  name: string;
  tier: 'basic' | 'premium' | 'pro';
  price: number; // en centavos MXN
  multiplier: string;
  color: string;
  emoji: string;
};

const SUBSCRIPTIONS: Subscription[] = [
  { name: 'Básico', tier: 'basic', price: 100, multiplier: '1.5x', color: '#6366F1', emoji: '⭐' },
  { name: 'Premium', tier: 'premium', price: 100, multiplier: '2x', color: '#F59E0B', emoji: '💎' },
  { name: 'Pro', tier: 'pro', price: 100, multiplier: '3x', color: '#EF4444', emoji: '🔥' },
];

export default function Home() {
  const [logs, setLogs] = useState<string[]>([]);
  const [authCode, setAuthCode] = useState<string>("");
  const [jwt, setJwt] = useState<string>("");
  const [userId, setUserId] = useState<string>("");
  const [paymentLoading, setPaymentLoading] = useState<string | null>(null);

  const addLog = (msg: string) => {
    setLogs((prev) => [...prev, `${new Date().toLocaleTimeString()} - ${msg}`]);
  };

  const APP_ID = process.env.NEXT_PUBLIC_TOKA_APP_ID || '3500020265479238';
  const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || '';

  const getBridge = () => {
    const w = window as any;
    if (typeof window !== "undefined" && w.AlipayJSBridge) {
      return w.AlipayJSBridge;
    }
    return null;
  };

  // ─── AUTH ───────────────────────────────────────────────

  const getAuthCode = (method: string, scopes: string[]) => {
    const bridge = getBridge();
    if (!bridge) {
      addLog("AlipayJSBridge no está disponible. Abre esta app desde Toka.");
      return;
    }

    addLog(`Llamando a getUser${method}AuthCode...`);
    
    let respondio = false;
    const to = setTimeout(() => {
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
      addLog("⚠️ No hay un AuthCode generado para enviar.");
      return;
    }
    
    addLog(`Enviando authCode (${authCode}) al backend...`);
    try {
      const res = await fetch(`${API_BASE}/api/toka/authenticate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authcode: authCode }),
      });
      const data = await res.json();

      if (res.ok && data.success && data.data?.accessToken) {
        addLog(`🎉 JWT Obtenido exitosamente ✓ (userId: ${data.data.userId})`);
        setJwt(data.data.accessToken);
        setUserId(data.data.userId || '');
      } else {
        addLog(`❌ Respuesta del servidor: ${JSON.stringify(data)}`);
      }
    } catch (e) {
      addLog(`❌ Error en fetch: ${(e as Error).message}`);
    }
  };

  // ─── PAYMENTS (SUSCRIPCIONES) ──────────────────────────

  const purchaseSubscription = async (sub: Subscription) => {
    const bridge = getBridge();

    // Paso 1: Verificar que el usuario tenga sesión
    if (!jwt) {
      addLog("⚠️ Primero debes autenticarte para comprar una suscripción.");
      return;
    }

    addLog(`💳 Creando orden de pago para suscripción ${sub.name}...`);
    setPaymentLoading(sub.tier);

    try {
      // Paso 2: Crear la orden de pago en el backend
      const res = await fetch(`/api/payments`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${jwt}`
        },
        body: JSON.stringify({
          amount: sub.price,
          userId: userId,
          orderTitle: `Suscripción ${sub.name} - ${sub.multiplier}`,
          subscriptionTier: sub.tier,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        addLog(`❌ Error creando orden: ${JSON.stringify(data)}`);
        setPaymentLoading(null);
        return;
      }

      const paymentUrl = data.data?.paymentUrl;
      const paymentId = data.data?.paymentId;

      addLog(`✅ Orden creada. PaymentId: ${paymentId || 'N/A'}`);
      
      // Paso 3: Abrir la pantalla de pago nativa de Toka
      // Documentación Toka: my.call('pay', { paymentUrl }) → en H5: AlipayJSBridge.call('pay', { paymentUrl }, callback)
      if (bridge && paymentUrl) {
        addLog(`📱 Abriendo pantalla de pago de Toka...`);
        
        bridge.call('pay', {
          paymentUrl: paymentUrl
        }, (payResult: any) => {
          addLog(`ℹ️ Resultado del pago: ${JSON.stringify(payResult)}`);
          
          const resultCode = String(payResult.resultCode || payResult.result_code || '');
          
          if (resultCode === '9000') {
            addLog(`🎉 ¡Pago exitoso! Suscripción ${sub.name} activada.`);
            if (paymentId) syncPayment(paymentId);
          } else if (resultCode === '6001') {
            addLog(`⚠️ Pago cancelado por el usuario.`);
          } else if (resultCode === '4000') {
            addLog(`❌ Pago fallido.`);
          } else {
            // Intentar sincronizar de todos modos para verificar estado real
            if (paymentId) syncPayment(paymentId);
          }
          setPaymentLoading(null);
        });
      } else if (!bridge) {
        addLog(`ℹ️ Sin bridge nativo. PaymentUrl: ${paymentUrl || 'No disponible'}`);
        setPaymentLoading(null);
      } else {
        addLog(`⚠️ El servidor no devolvió paymentUrl. Respuesta: ${JSON.stringify(data)}`);
        setPaymentLoading(null);
      }

    } catch (e) {
      addLog(`❌ Error en el proceso de pago: ${(e as Error).message}`);
      setPaymentLoading(null);
    }
  };

  // Paso 4: Sincronizar estado del pago con el backend
  const syncPayment = async (paymentId: string) => {
    if (!paymentId) return;
    addLog(`🔄 Sincronizando estado del pago ${paymentId}...`);
    try {
      const res = await fetch(`/api/payments/${paymentId}/sync`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${jwt}`
        },
      });
      const data = await res.json();
      addLog(`✅ Pago sincronizado: ${JSON.stringify(data)}`);
    } catch (e) {
      addLog(`❌ Error sincronizando pago: ${(e as Error).message}`);
    }
  };

  // ─── LIFECYCLE ─────────────────────────────────────────

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

  // ─── RENDER ────────────────────────────────────────────

  return (
    <div style={{ padding: 20, fontFamily: "sans-serif", maxWidth: 600, margin: "0 auto", background: "#f9f9f9", minHeight: "100vh", color: "#333" }}>
      <Script
        src="https://cdn.marmot-cloud.com/npm/hylid-bridge/2.10.0/index.js"
        strategy="beforeInteractive"
        onLoad={() => addLog("SDK hylid-bridge Cargado ✓")}
      />

      {/* ─── SECCIÓN AUTH ─── */}
      <h1 style={{ fontSize: 22, marginBottom: 8 }}>🔐 Autenticación Toka</h1>
      <p style={{ fontSize: 13, color: "#666", marginBottom: 16 }}>
        Paso 1: Obtén un AuthCode → Paso 2: Canjéalo por JWT
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "16px" }}>
        <button onClick={() => getAuthCode('DigitalIdentity', ['USER_ID', 'USER_AVATAR', 'USER_NICKNAME'])} style={btnAuthStyle}>
          1. Digital Identity
        </button>
        <button onClick={() => getAuthCode('ContactInformation', ['PLAINTEXT_MOBILE_PHONE', 'PLAINTEXT_EMAIL_ADDRESS'])} style={btnAuthStyle}>
          2. Contact Info
        </button>
        <button onClick={() => getAuthCode('AddressInformation', ['USER_ADDRESS'])} style={btnAuthStyle}>
          3. Address Info
        </button>
        <button onClick={() => getAuthCode('PersonalInformation', ['USER_NAME', 'USER_FIRST_SURNAME', 'USER_SECOND_SURNAME', 'USER_GENDER', 'USER_BIRTHDAY', 'USER_STATE_OF_BIRTH', 'USER_NATIONALITY'])} style={btnAuthStyle}>
          4. Personal Info
        </button>
        <button onClick={() => getAuthCode('KYCStatus', ['USER_KYC_STATUS'])} style={btnAuthStyle}>
          5. KYC Status
        </button>
      </div>

      <div style={{ background: '#E0E7FF', padding: 12, borderRadius: 8, marginBottom: 12, border: '1px solid #C7D2FE' }}>
        <strong style={{ display: 'block', marginBottom: 4, color: '#3730A3', fontSize: 13 }}>AuthCode:</strong>
        <code style={{ wordBreak: 'break-all', fontSize: 14 }}>{authCode || "—"}</code>
      </div>

      <button onClick={authenticateWithServer} style={btnCanjeStyle}>
        CANJEAR AUTHCODE → JWT
      </button>

      {jwt && (
        <div style={{ background: '#DCFCE7', padding: 12, borderRadius: 8, marginBottom: 20, border: '1px solid #BBF7D0' }}>
          <strong style={{ display: 'block', marginBottom: 4, color: '#166534', fontSize: 13 }}>JWT activo ✓</strong>
          <code style={{ wordBreak: 'break-all', fontSize: 10 }}>{jwt.slice(0, 60)}...</code>
        </div>
      )}

      {/* ─── SECCIÓN SUSCRIPCIONES ─── */}
      <div style={{ borderTop: '2px solid #E5E7EB', paddingTop: 20, marginTop: 10 }}>
        <h2 style={{ fontSize: 20, marginBottom: 6 }}>💳 Suscripciones</h2>
        <p style={{ fontSize: 13, color: "#666", marginBottom: 16 }}>
          Adquiere un plan para obtener multiplicadores de puntos al finalizar la temporada semanal.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {SUBSCRIPTIONS.map((sub) => (
            <div
              key={sub.tier}
              style={{
                background: 'white',
                border: `2px solid ${sub.color}`,
                borderRadius: 12,
                padding: 16,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div>
                <div style={{ fontSize: 18, fontWeight: 'bold', color: sub.color }}>
                  {sub.emoji} {sub.name}
                </div>
                <div style={{ fontSize: 13, color: '#666', marginTop: 2 }}>
                  Multiplicador: <strong>{sub.multiplier}</strong> puntos
                </div>
                <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>
                  $1.00 MXN (test)
                </div>
              </div>
              <button
                onClick={() => purchaseSubscription(sub)}
                disabled={!jwt || paymentLoading === sub.tier}
                style={{
                  padding: '10px 20px',
                  fontSize: 14,
                  fontWeight: 'bold',
                  cursor: jwt ? 'pointer' : 'not-allowed',
                  background: jwt ? sub.color : '#ccc',
                  color: 'white',
                  border: 'none',
                  borderRadius: 8,
                  opacity: paymentLoading === sub.tier ? 0.6 : 1,
                }}
              >
                {paymentLoading === sub.tier ? '⏳...' : 'Comprar'}
              </button>
            </div>
          ))}
        </div>

        {!jwt && (
          <p style={{ fontSize: 12, color: '#EF4444', marginTop: 10, textAlign: 'center' }}>
            ⚠️ Autentícate primero para poder comprar suscripciones.
          </p>
        )}
      </div>

      {/* ─── LOG ─── */}
      <div style={{ background: '#1E293B', color: '#10B981', padding: 15, borderRadius: 8, minHeight: 200, fontFamily: 'monospace', fontSize: 11, overflowY: 'auto', marginTop: 20 }}>
        <strong style={{ display: 'block', marginBottom: 10, color: '#94A3B8' }}>LOG DE EVENTOS:</strong>
        {logs.length === 0 ? <span style={{ color: '#64748B' }}>Sin actividad...</span> : null}
        {logs.map((log, i) => (
          <div key={i} style={{ marginBottom: 4 }}>{log}</div>
        ))}
      </div>
    </div>
  );
}

// ─── ESTILOS ─────────────────────────────────────────────

const btnAuthStyle = {
  padding: '8px 12px',
  fontSize: 13,
  cursor: 'pointer',
  background: '#4F46E5',
  color: 'white',
  border: 'none',
  borderRadius: 5,
};

const btnCanjeStyle = {
  width: '100%' as const,
  padding: '12px 20px',
  fontSize: 15,
  cursor: 'pointer',
  background: '#10B981',
  color: 'white',
  border: 'none',
  borderRadius: 8,
  marginBottom: 16,
  fontWeight: 'bold' as const,
};
