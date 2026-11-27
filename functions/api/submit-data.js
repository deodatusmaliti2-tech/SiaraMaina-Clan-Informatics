export async function onRequestPost({ request, env }) {
  if (!env.DB) {
    return Response.json(
      { success: false, error: "Cloudflare D1 binding DB is not configured." },
      { status: 503 },
    );
  }

  try {
    const { name, content } = await request.json();
    if (!name || !content) {
      return Response.json(
        { success: false, error: "Name and Content fields are required." },
        { status: 400 },
      );
    }

    await env.DB.prepare("INSERT INTO entries (name, content) VALUES (?, ?)")
      .bind(name, content)
      .run();

    return Response.json({ success: true, message: "Data saved successfully!" });
  } catch {
    return Response.json(
      { success: false, error: "Data could not be saved." },
      { status: 500 },
    );
  }
}
