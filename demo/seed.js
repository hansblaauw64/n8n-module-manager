// Demo data for the recording (demo/record.mjs). Loaded after stub.js. Everything here is made up:
// one instance, a few modules, schedules, a webhook, a subworkflow and executions. No real n8n is contacted.
(() => {
  const BASE = 'https://n8n.example.com';
  window.__store.local.instances = [{ id: 'demo', name: 'Demo n8n', url: BASE, key: 'DEMO-KEY', env: 'productie' }];
  window.__tabs[0].url = BASE + '/home/workflows';
  // The fake chrome.storage is empty again after a reload; the demo keeps a chosen language in localStorage.
  try { const lang = localStorage.getItem('demoLanguage'); if (lang) window.__store.local.settings = { language: lang }; } catch { /* ignore */ }

  const tag = (id, name) => ({ id, name });
  const T = { rap: tag('t1', 'mod:rapportage'), crm: tag('t2', 'mod:crm'), fac: tag('t3', 'mod:facturatie') };
  const schedule = (rule) => ({ type: 'n8n-nodes-base.scheduleTrigger', name: 'Schedule', parameters: { rule: { interval: [rule] } } });
  const webhook = (path) => ({ type: 'n8n-nodes-base.webhook', name: 'Webhook', webhookId: 'a1b2c3', parameters: { httpMethod: 'POST', path } });
  const call = (id) => ({ type: 'n8n-nodes-base.executeWorkflow', name: 'Verrijk contact', parameters: { workflowId: { __rl: true, mode: 'id', value: id } } });
  const sub = { type: 'n8n-nodes-base.executeWorkflowTrigger', name: 'Start', parameters: {} };
  const http = (url) => ({ type: 'n8n-nodes-base.httpRequest', name: 'HTTP Request', parameters: { url } });
  const manual = { type: 'n8n-nodes-base.manualTrigger', name: 'Start', parameters: {} };

  const WF = [
    { id: 'wfDag', name: 'Dagrapport naar directie', active: true, tags: [T.rap], nodes: [schedule({ triggerAtHour: 14 }), http('https://api.example.com/report')] },
    { id: 'wfWeek', name: 'Weekrapport', active: true, tags: [T.rap], nodes: [schedule({ field: 'weeks', triggerAtDay: [1], triggerAtHour: 9 })] },
    { id: 'wfLead', name: 'Nieuwe lead verwerken', active: true, tags: [T.crm], nodes: [webhook('lead'), call('wfVerrijk')] },
    { id: 'wfVerrijk', name: 'Contact verrijken', active: true, tags: [T.crm], nodes: [sub, http('https://api.example.com/enrich')] },
    { id: 'wfSync', name: 'CRM sync', active: true, tags: [T.crm], nodes: [schedule({ field: 'hours' })] },
    { id: 'wfFact', name: 'Facturen versturen', active: true, tags: [T.fac], nodes: [schedule({ triggerAtHour: 14 })] },
    { id: 'wfBetaal', name: 'Betalingen controleren', active: false, tags: [T.fac], nodes: [schedule({ field: 'minutes', minutesInterval: 15 })] },
    { id: 'wfTest', name: 'Testflow Slack-bericht', active: false, tags: [], nodes: [manual] },
  ];

  // Executions: newest first. status per run, minutes ago, duration in seconds.
  const runs = (wf, list) => list.map(([status, minAgo, dur, mode = 'trigger'], i) => {
    const start = Date.now() - minAgo * 60000;
    return { id: String(5000 - i * 7 - wf.length * 31), workflowId: wf, status, mode, finished: status === 'success',
      startedAt: new Date(start).toISOString(), stoppedAt: dur == null ? null : new Date(start + dur * 1000).toISOString() };
  });
  const daily = (n, fails) => Array.from({ length: n }, (_, i) => [fails.includes(i) ? 'error' : 'success', 60 * 24 * i + 90, 2 + (i % 5) * 1.7]);
  const EX = {
    wfDag: runs('wfDag', [['running', 1, null], ['error', 25, 3.1, 'manual'], ...daily(26, [3, 9])]),
    wfWeek: runs('wfWeek', [['success', 60 * 50, 41]]),
    wfLead: runs('wfLead', [['success', 4, 0.8, 'webhook'], ['success', 33, 0.6, 'webhook'], ['success', 95, 0.9, 'webhook']]),
    wfVerrijk: runs('wfVerrijk', [['success', 4, 0.5, 'integrated'], ['success', 33, 0.4, 'integrated']]),
    wfSync: runs('wfSync', [['success', 12, 7], ['success', 72, 6]]),
    wfFact: runs('wfFact', [['error', 180, 12], ['success', 180 + 1440, 9]]),
    wfBetaal: runs('wfBetaal', [['success', 3000, 1]]),
  };

  const TIPS = [
    ['Voorbeeldtip: geef elke module een eigen tag', 'Workflows'],
    ['Voorbeeldtip: zet subworkflows in dezelfde module', 'Werkwijze'],
    ['Voorbeeldtip: test eerst op een test-instance', 'Veiligheid'],
  ];
  const rss = '<rss><channel>' + TIPS.map(([t, c], i) => `<item><title>${t}</title><link>https://things.io/demo-${i}</link><category>${c}</category><description>Dit is voorbeeldtekst voor de demo.</description></item>`).join('') + '</channel></rss>';

  const prev = window.fetch;
  window.fetch = async (url, opts = {}) => {
    const u = new URL(String(url), location.href);
    if (u.origin === BASE) {
      window.__requests.push({ url: String(url), method: opts.method || 'GET' });
      await new Promise((r) => setTimeout(r, 120)); // a little network delay, so loading states are visible
      if (u.pathname === '/api/v1/workflows') return Response.json({ data: WF, nextCursor: null });
      if (u.pathname === '/api/v1/tags') return Response.json({ data: Object.values(T) });
      const one = u.pathname.match(/^\/api\/v1\/executions\/([^/]+)$/);
      if (one) {
        // One execution; with includeData a failed one carries an error in the shape n8n uses (docs/findings.md).
        const ex = Object.values(EX).flat().find((e) => e.id === one[1]);
        if (!ex) return new Response('{}', { status: 404 });
        if (u.searchParams.get('includeData') !== 'true' || ex.status !== 'error') return Response.json(ex);
        const byManual = ex.mode === 'manual';
        const error = byManual
          ? { message: 'Cannot read properties of undefined (reading \'email\')', name: 'NodeOperationError', node: { name: 'Code', type: 'n8n-nodes-base.code' },
            description: 'Regel 4: item.json.contact.email bestaat niet in dit item (voorbeeldfout).', stack: 'NodeOperationError: Cannot read properties of undefined (reading \'email\')\n    at Code.execute (voorbeeld)\n    at WorkflowExecute.runNode (voorbeeld)' }
          : { message: 'Bad request - please check your parameters', name: 'NodeApiError', httpCode: '400', node: { name: 'HTTP Request', type: 'n8n-nodes-base.httpRequest' },
            description: '400 - {"error":"invalid_date","detail":"Parameter \'from\' moet een datum zijn (voorbeeldfout)"}', stack: 'NodeApiError: Bad request - please check your parameters\n    at HttpRequest.execute (voorbeeld)\n    at WorkflowExecute.runNode (voorbeeld)' };
        return Response.json({ ...ex, data: { resultData: { error, runData: {}, lastNodeExecuted: error.node.name } } });
      }
      if (u.pathname === '/api/v1/executions') {
        const list = EX[u.searchParams.get('workflowId')] || [];
        const limit = Number(u.searchParams.get('limit')) || 20;
        const from = Number(u.searchParams.get('cursor') || 0);
        const page = list.slice(from, from + limit);
        return Response.json({ data: page, nextCursor: from + limit < list.length ? String(from + limit) : null });
      }
      return new Response('{}', { status: 404 });
    }
    if (u.href.includes('rss')) return new Response(rss);
    return prev(url, opts);
  };
})();
