import { useEffect, useRef, useState } from 'react';
import { UnicoCheckBuilder, UnicoConfig, SDKEnvironmentTypes } from 'unico-webframe';
import config from '../config';

const describe = (error) => `${error?.code ?? ''} ${error?.message ?? error}`.trim();

/**
 * IDPay Silent Flow POC (web): silent device data collection through the Unico
 * web SDK (initializeSDK + startSilentValidation — the camera is never opened),
 * followed by an IDPay transaction that is approved silently when the collected
 * device matches the user history.
 */
export default function SilentFlow() {
  // Fields survive the same-tab round trip to the fallback challenge
  // (sessionStorage is cleared when the tab closes).
  const stored = (key, fallback) => sessionStorage.getItem(key) ?? fallback;
  const [externalUserId, setExternalUserId] = useState(() => stored('externalUserId', ''));
  const [cpf, setCpf] = useState(() => stored('cpf', '12345678901'));
  const [bin, setBin] = useState(() => stored('bin', '87654321'));
  const [lastDigits, setLastDigits] = useState(() => stored('lastDigits', '7890'));
  const [token, setToken] = useState(() => stored('token', ''));

  useEffect(() => {
    sessionStorage.setItem('externalUserId', externalUserId);
    sessionStorage.setItem('cpf', cpf);
    sessionStorage.setItem('bin', bin);
    sessionStorage.setItem('lastDigits', lastDigits);
    sessionStorage.setItem('token', token);
  }, [externalUserId, cpf, bin, lastDigits, token]);

  const [status, setStatus] = useState('Pronto para iniciar');
  const [logs, setLogs] = useState([]);
  const [overlay, setOverlay] = useState(null); // null | 'processing' | 'approved'

  // When the last collection becomes available to the transaction: send
  // confirmation + processing margin.
  const collectReadyAtRef = useRef(0);
  const sdkRef = useRef(null);

  const addLog = (message) => {
    const ts = new Date().toLocaleTimeString('pt-BR');
    setLogs((prev) => [...prev, `[${ts}] ${message}`]);
  };

  // Opens a collection session in background. One session serves one
  // validation journey, so a new one is opened for each validation.
  const openSession = () => {
    const camera = new UnicoCheckBuilder()
      .setEnvironment(SDKEnvironmentTypes[config.SDK_ENVIRONMENT])
      .build();
    const unicoConfig = new UnicoConfig()
      .setHostname(config.HOSTNAME || window.location.origin)
      .setHostKey(config.SDK_KEY);
    const ready = camera.initializeSDK(unicoConfig);
    ready
      .then(() => addLog('initializeSDK: ok — collection session ready'))
      .catch((error) => addLog(`initializeSDK FAILED: ${describe(error)}`));
    sdkRef.current = { camera, ready };
    return sdkRef.current;
  };

  // The first session opens as soon as the page loads, off the critical
  // path: by the time the user acts, only the collection itself is left.
  useEffect(() => {
    if (!sdkRef.current) openSession();
  }, []);

  // Return from the fallback challenge (transaction redirectUrl).
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('challenge') === 'finished') {
      setStatus('✓ Challenge concluído — usuário de volta à página');
      addLog('challenge finished — user returned via redirectUrl');
    }
  }, []);

  // The identifier typed on screen; the CPF is the fallback when it is empty.
  // In a real integration this is whatever id the client has for the user.
  const resolveExternalUserId = () => externalUserId.trim() || cpf.trim();

  // ------------------------------------------------------------- collection

  /** Runs the silent collection. No camera is ever shown. */
  const collect = async () => {
    const id = resolveExternalUserId();
    if (!id) throw new Error('fill the externalUserId (or the CPF)');

    setStatus('⏳ Coletando dados de device…');
    let session = sdkRef.current;
    try {
      await session.ready;
    } catch {
      session = openSession();
      await session.ready;
    }

    try {
      // Resolves once the collection has been sent.
      await session.camera.startSilentValidation(id, config.USE_CASE);
    } finally {
      openSession();
    }

    collectReadyAtRef.current = Date.now() + config.POST_SEND_WAIT_MS;
    setStatus(`✓ Dados de device enviados (${new Date().toLocaleTimeString('pt-BR')})`);
    addLog(`collect: sent for externalUserId=${id}`);
  };

  const onCollectClick = async () => {
    try {
      await collect();
    } catch (error) {
      onCollectError(error);
    }
  };

  // Without a collection, the transaction simply follows the standard flow
  // with the visual challenge.
  const onCollectError = (error) => {
    collectReadyAtRef.current = 0;
    setStatus('✖ Falha na coleta de device');
    addLog(`collect FAILED: ${describe(error)}`);
  };

  // ------------------------------------------------------------ transaction

  /**
   * Creates the transaction. Right after a collection, the remaining
   * processing margin is absorbed into the loading overlay.
   */
  const createTransactionWhenReady = () => {
    const missing = [];
    if (!cpf.trim()) missing.push('CPF');
    if (!bin.trim()) missing.push('binDigits');
    if (!lastDigits.trim()) missing.push('lastDigits');
    if (!token.trim()) missing.push('Bearer token');
    if (config.COMPANY_ID.startsWith('YOUR_')) missing.push('VITE_COMPANY_ID (.env.local)');
    if (missing.length > 0) {
      addLog(`ERROR: missing ${missing.join(', ')}`);
      return;
    }

    setOverlay('processing');
    const remainingMs = collectReadyAtRef.current - Date.now();
    if (remainingMs > 0) {
      addLog(`transaction: waiting ${remainingMs}ms of processing margin`);
      setTimeout(createTransaction, remainingMs);
    } else {
      createTransaction();
    }
  };

  const createTransaction = async () => {
    const body = {
      identity: { key: 'cpf', value: cpf.trim() },
      orderNumber: `silent-flow-react-poc-${Date.now()}`,
      company: config.COMPANY_ID,
      // Brings the user back to this page after the fallback challenge.
      redirectUrl: `${window.location.origin}/?challenge=finished`,
      card: {
        binDigits: bin.trim(),
        lastDigits: lastDigits.trim(),
        expirationDate: '12/28',
        name: 'Silent Flow React Poc',
      },
      value: 10.5,
      additionalInfo: { externalUserID: resolveExternalUserId() },
    };

    // The /idpay prefix hits the Vite dev proxy (vite.config.js), which plays
    // the role of the CLIENT's backend calling the IDPay API server-to-server.
    addLog('transaction: POST /idpay/api/public/v1/credit/transaction');

    try {
      const res = await fetch('/idpay/api/public/v1/credit/transaction', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token.trim()}`,
        },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => null);
      onTransactionResponse(res.status, json);
    } catch (error) {
      addLog(`request ERROR: ${describe(error)}`);
      setOverlay(null);
    }
  };

  const onTransactionResponse = (code, json) => {
    if (code < 200 || code >= 300 || !json) {
      addLog(`HTTP ${code}: ${JSON.stringify(json)?.slice(0, 400)}`);
      setOverlay(null);
      return;
    }

    const { status: trnStatus, id, link } = json;
    addLog(`HTTP ${code} · id=${id} · status=${trnStatus}`);

    if (trnStatus === 'approved') {
      addLog('✔ SILENT APPROVAL — no challenge needed');
      setOverlay('approved');
      setTimeout(() => setOverlay(null), 3000);
    } else if (link) {
      // Same-tab redirect, as a real client integration would do.
      addLog('challenge required — redirecting to fallback');
      setOverlay(null);
      window.location.href = link;
    } else {
      addLog(`status=${trnStatus} without link — not approved`);
      setOverlay(null);
    }
  };

  const onFullFlow = async () => {
    try {
      await collect();
      createTransactionWhenReady();
    } catch (error) {
      onCollectError(error);
    }
  };

  // ------------------------------------------------------------------ view

  const field = 'w-full border border-gray-300 rounded-xl px-4 py-3 text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-600';

  return (
    <div className="container mx-auto px-4 py-8 max-w-xl">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
        <h1 className="text-lg font-bold text-gray-900">Teste de validação silenciosa</h1>
        <p className="text-sm text-gray-500 mb-5">{status}</p>

        <div className="space-y-3">
          <input className={field} placeholder="externalUserId (CPF/e-mail/ID do usuário)"
            value={externalUserId} onChange={(e) => setExternalUserId(e.target.value)} />
          <input className={field} placeholder="identity.value (CPF)"
            value={cpf} onChange={(e) => setCpf(e.target.value)} />
          <div className="flex gap-2">
            <input className={field} placeholder="card.binDigits (8)" maxLength={8}
              value={bin} onChange={(e) => setBin(e.target.value)} />
            <input className={field} placeholder="card.lastDigits (4)" maxLength={4}
              value={lastDigits} onChange={(e) => setLastDigits(e.target.value)} />
          </div>
          <input className={field} type="password" placeholder="Bearer token (colar manualmente)"
            value={token} onChange={(e) => setToken(e.target.value)} />
        </div>

        <div className="mt-5 space-y-2">
          <button onClick={onCollectClick}
            className="w-full h-12 rounded-xl border border-blue-600 text-blue-600 font-semibold hover:bg-blue-50 transition-colors">
            Coletar dados de device
          </button>
          <button onClick={createTransactionWhenReady}
            className="w-full h-12 rounded-xl border border-blue-600 text-blue-600 font-semibold hover:bg-blue-50 transition-colors">
            Criar transação silenciosa
          </button>
          <button onClick={onFullFlow}
            className="w-full h-12 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-700 transition-colors">
            Fluxo completo (coleta + transação)
          </button>
        </div>
      </div>

      <div className="mt-4 bg-slate-900 rounded-2xl p-4 h-48 flex flex-col">
        <div className="flex justify-between items-center mb-2">
          <span className="text-white text-sm font-bold">Logs</span>
          <button onClick={() => setLogs([])} className="text-blue-300 text-sm">Limpar</button>
        </div>
        <pre className="flex-1 overflow-auto text-xs text-blue-100 font-mono whitespace-pre-wrap">
          {logs.length > 0 ? logs.join('\n') : 'Logs aparecerão aqui…'}
        </pre>
      </div>

      {overlay && (
        <div
          className={`fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 ${
            overlay === 'approved' ? 'bg-green-700' : 'bg-slate-900'
          }`}
          onClick={() => overlay === 'approved' && setOverlay(null)}
        >
          {overlay === 'processing' && (
            <>
              <div className="w-12 h-12 border-4 border-slate-600 border-t-white rounded-full animate-spin" />
              <p className="text-white text-xl font-bold">Finalizando últimos ajustes…</p>
            </>
          )}
          {overlay === 'approved' && (
            <>
              <span className="text-7xl">✔</span>
              <p className="text-white text-xl font-bold">Aprovado!</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
