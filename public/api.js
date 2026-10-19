// ProjectFlow API client
const API = (() => {
  async function req(method, url, body) {
    const opts = { method, headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin' };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    let data = null;
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) data = await res.json();
    else if (res.status !== 204) data = await res.text();
    if (!res.ok) {
      const err = new Error((data && data.error) || `Request failed (${res.status})`);
      err.status = res.status; err.data = data;
      throw err;
    }
    return data;
  }
  const get = (u) => req('GET', u);
  const post = (u, b) => req('POST', u, b);
  const put = (u, b) => req('PUT', u, b);
  const del = (u) => req('DELETE', u);
  return { get, post, put, del };
})();
