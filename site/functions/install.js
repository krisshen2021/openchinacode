export async function onRequest() {
  const response = await fetch("https://raw.githubusercontent.com/krisshen2021/openchinacode/main/install", {
    headers: {
      "user-agent": "OpenChinaCode Pages installer",
    },
  })

  return new Response(response.body, {
    status: response.status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=300",
      "x-content-type-options": "nosniff",
    },
  })
}
