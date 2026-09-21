/* ============================================================
 * 西南 F4 相册 · Cloudflare Worker 中间人
 * 接口：
 *   GET    /list    读取仓库照片/视频列表
 *   POST   /upload  上传（JSON: password, filename, content[Base64]）
 *   POST   /delete  删除（JSON: password, name）
 * 所有敏感值都通过环境变量提供，代码里不出现任何密钥。
 * ============================================================ */

export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": env.ALLOW_ORIGIN || "*",
      "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }

    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/list") {
      return handleList(env, cors);
    }
    if (request.method === "POST" && url.pathname === "/upload") {
      return handleUpload(request, env, cors);
    }
    if (request.method === "POST" && url.pathname === "/delete") {
      return handleDelete(request, env, cors);
    }

    return json({ ok: false, error: "not found" }, 404, cors);
  },
};

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function ghHeaders(env) {
  return {
    "Authorization": `Bearer ${env.GH_TOKEN}`,
    "Accept": "application/vnd.github+json",
    "User-Agent": "memory-album-worker",
  };
}

function checkPassword(env, password) {
  return !env.UPLOAD_PASSWORD || password === env.UPLOAD_PASSWORD;
}

async function handleUpload(request, env, cors) {
  try {
    const body = await request.json();
    const { password, filename, content } = body;

    if (!checkPassword(env, password)) {
      return json({ ok: false, error: "密码错误" }, 401, cors);
    }
    if (!filename || !content) {
      return json({ ok: false, error: "缺少 filename 或 content" }, 400, cors);
    }

    const safe = String(filename).replace(/[^\w.\-]/g, "_");
    const dir = env.PHOTO_DIR || "photos";
    const path = `${dir}/${Date.now()}-${safe}`;

    const api = `https://api.github.com/repos/${env.GH_OWNER}/${env.GH_REPO}/contents/${path}`;

    const res = await fetch(api, {
      method: "PUT",
      headers: { ...ghHeaders(env), "Content-Type": "application/json" },
      body: JSON.stringify({
        message: `upload ${path}`,
        content,
        branch: env.GH_BRANCH || "main",
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      return json({ ok: false, error: data.message || "GitHub 提交失败" }, 500, cors);
    }
    return json({ ok: true, path, url: data.content && data.content.download_url }, 200, cors);
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500, cors);
  }
}

async function handleList(env, cors) {
  try {
    const dir = env.PHOTO_DIR || "photos";
    const ref = env.GH_BRANCH || "main";
    const api = `https://api.github.com/repos/${env.GH_OWNER}/${env.GH_REPO}/contents/${dir}?ref=${ref}`;

    const res = await fetch(api, { headers: ghHeaders(env) });
    const data = await res.json();

    if (!res.ok) {
      return json({ ok: false, error: data.message || "读取失败" }, 500, cors);
    }

    const files = (Array.isArray(data) ? data : [])
      .filter((f) =>
        f.type === "file" &&
        /\.(jpe?g|png|gif|webp|avif|heic|mp4|mov|webm)$/i.test(f.name)
      )
      .map((f) => ({ name: f.name, url: f.download_url }));

    return json({ ok: true, files }, 200, cors);
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500, cors);
  }
}

async function handleDelete(request, env, cors) {
  try {
    const body = await request.json();
    const { password, name } = body;

    if (!checkPassword(env, password)) {
      return json({ ok: false, error: "密码错误" }, 401, cors);
    }
    if (!name) {
      return json({ ok: false, error: "缺少 name" }, 400, cors);
    }

    const safe = String(name).replace(/[^\w.\-]/g, "_");
    const dir = env.PHOTO_DIR || "photos";
    const ref = env.GH_BRANCH || "main";
    const path = `${dir}/${safe}`;
    const api = `https://api.github.com/repos/${env.GH_OWNER}/${env.GH_REPO}/contents/${path}`;

    const info = await fetch(`${api}?ref=${ref}`, { headers: ghHeaders(env) });
    const infoData = await info.json();
    if (!info.ok) {
      return json({ ok: false, error: infoData.message || "文件不存在" }, 404, cors);
    }

    const res = await fetch(api, {
      method: "DELETE",
      headers: { ...ghHeaders(env), "Content-Type": "application/json" },
      body: JSON.stringify({
        message: `delete ${path}`,
        sha: infoData.sha,
        branch: ref,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      return json({ ok: false, error: data.message || "删除失败" }, 500, cors);
    }
    return json({ ok: true, path }, 200, cors);
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500, cors);
  }
}
