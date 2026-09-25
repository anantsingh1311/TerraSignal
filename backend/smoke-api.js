process.env.DB_CLIENT = "sqlite";
process.env.TERRASIGNAL_DB_PATH = ":memory:";

const { server, store } = await import("./server.js");

const baseUrl = await new Promise((resolve) => {
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    resolve(`http://127.0.0.1:${address.port}`);
  });
});

// The survey/project surface is authenticated, so the smoke run signs in first
// and carries the session on every call.
let sessionToken = "";

const requestJson = async (path, init = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      ...(sessionToken ? { authorization: `Bearer ${sessionToken}` } : {}),
    },
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`${path} failed with ${response.status}: ${payload?.error?.message || text}`);
  }
  return payload;
};

const authorizedFetch = (path) =>
  fetch(`${baseUrl}${path}`, { headers: sessionToken ? { authorization: `Bearer ${sessionToken}` } : {} });

try {
  const health = await requestJson("/api/health");

  // The project/run surface must refuse anonymous callers.
  const anonymousBootstrap = await fetch(`${baseUrl}/api/bootstrap`);
  if (anonymousBootstrap.status !== 401) {
    throw new Error(`Bootstrap must require authentication, got ${anonymousBootstrap.status}.`);
  }

  const registration = await requestJson("/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: `smoke-${Date.now()}@example.com`,
      password: "SmokeCheck#2026x",
      name: "Smoke Check",
      company: "QA",
    }),
  });
  sessionToken = registration.token;

  const bootstrap = await requestJson("/api/bootstrap");
  const project = bootstrap.projects[0];
  if (!project) throw new Error("Bootstrap did not return a seeded project.");

  const created = await requestJson(`/api/projects/${encodeURIComponent(project.id)}/runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      datasetLabel: "API smoke survey",
      fileName: "smoke.csv",
      csvText: "id,x,y,depth,resistivity,velocity,magnetic,noise\nS-01,1,2,3,40,1200,48000,10",
      settings: { anomalyThreshold: 70, focus: "HYBRID" },
    }),
  });

  const runs = await requestJson(`/api/projects/${encodeURIComponent(project.id)}/runs`);
  const run = await requestJson(`/api/runs/${encodeURIComponent(created.run.id)}`);
  const report = await authorizedFetch(`/api/runs/${encodeURIComponent(created.run.id)}/report`);
  const csv = await authorizedFetch(`/api/runs/${encodeURIComponent(created.run.id)}/anomalies.csv`);

  if (!runs.runs.length) throw new Error("Saved run list is empty after creating a run.");
  if (!run.run.reportText) throw new Error("Saved run detail is missing report text.");
  if (!report.ok || !csv.ok) throw new Error("Report or CSV export route failed.");

  console.log(
    JSON.stringify(
      {
        ok: true,
        database: health.database,
        projectCount: bootstrap.projects.length,
        savedRuns: runs.runs.length,
        authenticationEnforced: true,
        message: "API smoke check passed.",
      },
      null,
      2,
    ),
  );
} finally {
  await new Promise((resolve) => server.close(resolve));
  await store.close();
}
