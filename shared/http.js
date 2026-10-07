export const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// Nuvio on iOS closes the QuickJS runtime as soon as getStreams settles (or after its 60 s timeout); a fetch still
// in flight at that moment aborts the whole app. So every request goes through send(), and provider() only
// answers once none is running. After DEADLINE_MS no new request starts, to stay clear of Nuvio's timeout.
// Nuvio TV's fetch blocks, so a plugin's requests run one after the other and cannot be aborted, and it runs ten
// plugins at a time: a slow one holds a slot the others wait for. The budget is what keeps that short.
const DEADLINE_MS = 25000;
let running = 0, idle = [], deadline = Infinity;

export function send(url, opts) {
    if (Date.now() > deadline) return Promise.reject(new Error(`deadline reached, skipped ${url}`));
    running++;
    const done = () => { if (--running === 0) idle.splice(0).forEach(resolve => resolve()); };
    return fetch(url, opts).then(res => { done(); return res; }, err => { done(); throw err; });
}

// Nuvio mobile/desktop show only `name` and `quality` (not `title`), Nuvio TV shows `name - quality` plus `title`,
// so the language goes into the name and 'auto' becomes the stream format.
const SUBBED = [[/ger(man)?[\s._-]*sub|untertitel deutsch/i, 'Original, dt. UT'], [/eng(lish)?[\s._-]*sub|untertitel englisch/i, 'Original, engl. UT']];
const LANGS = [[/japanisch, dt\. ut/i, 'Japanisch, dt. UT'], [/japanisch, engl\. ut/i, 'Japanisch, engl. UT']].concat(SUBBED, [
    [/\bomu\b/i, 'OmU'], [/\bov\b/i, 'OV'], [/englisch|\ben\b/i, 'Englisch'], [/franz|\bfr\b/i, 'Französisch'], [/spanisch/i, 'Spanisch'],
    [/japanisch/i, 'Japanisch'], [/deutsch|\bde\b/i, 'Deutsch']]);

// internal language label -> what the stream list shows: flags read faster than words, and subtitles stay marked "UT"
const FLAGS = { Deutsch: '🇩🇪', Englisch: '🇬🇧', Französisch: '🇫🇷', Spanisch: '🇪🇸', Japanisch: '🇯🇵', OV: '🌐', OmU: '🌐 UT' };
const SUB_FLAGS = { 'dt. UT': '🇩🇪', 'engl. UT': '🇬🇧' };
export function flagLabel(lang) {
    const sub = lang.match(/^(.*), (dt\. UT|engl\. UT)$/);
    if (sub) return `${sub[1] === 'Original' ? '🌐' : FLAGS[sub[1]] || sub[1]} UT ${SUB_FLAGS[sub[2]]}`;
    return FLAGS[lang] || lang;
}

// stream URL -> the hoster's file name, where the hoster shows one. Sites like huhu.to file "…GerSub.720p…" under plain
// German, so a file name that says "subbed" beats a title that only says German.
export const fileNames = {};

function decorate(s) {
    const hit = LANGS.find(([re]) => re.test(s.title || ''));
    let lang = hit ? hit[1] : 'Deutsch', title = s.title;
    const sub = SUBBED.find(([re]) => re.test(fileNames[s.url] || ''));
    if (sub && !/UT|OmU/.test(lang)) {
        lang = sub[1];
        // Nuvio TV shows the title under the name, so it must not keep saying "Deutsch"
        title = hit ? title.replace(hit[0], lang) : [title, lang].filter(Boolean).join(' · ');
    }
    const quality = s.quality && s.quality !== 'auto' ? s.quality : (/\.m3u8|\/hls|master/i.test(s.url) ? 'HLS' : 'MP4');
    const host = ((s.title || '').split(' · ')[0].match(/^[\w-]+\.[a-z]{2,}$/) || [])[0];
    const tags = releaseTags(fileNames[s.url]);
    if (tags.length) title = [title].concat(tags).filter(Boolean).join(' · ');
    return { lang, stream: Object.assign({}, s, { name: [s.name, flagLabel(lang), host].filter(Boolean).join(' · '), title, quality }) };
}

// Details for the stream list's second line (Nuvio TV shows `title`). Everything here never throws and only costs requests
// for the first few streams while enough of the time budget is left.
const CODECS = [[/hvc1|hev1|hevc|x265|h\.?265/i, 'H.265'], [/avc1|x264|h\.?264/i, 'H.264'], [/av01|\bav1\b/i, 'AV1'], [/vp0?9/i, 'VP9']];
const codecName = text => (CODECS.find(([re]) => re.test(text)) || [])[1];
const mbit = bps => `${(bps / 1e6).toFixed(1).replace('.', ',')} Mbit/s`;
const gigabytes = bytes => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1).replace('.', ',')} GB` : `${Math.round(bytes / 1e6)} MB`);

// release name -> source and audio tags ("BluRay · AC3"), for hosters that show the file name
function releaseTags(name) {
    return [/blu-?ray|remux|web-?dl|web-?rip|hdtv|dvd-?rip/i, /atmos|truehd|dts-?hd|dts|e-?ac-?3|ac-?3|aac/i, /x26[45]|h\.?26[45]|hevc|av1/i]
        .map(re => (String(name || '').match(re) || [])[0]).filter(Boolean).map(t => (/^(x|h\.?)26[45]$/i.test(t) || /hevc/i.test(t) ? codecName(t) : t));
}

// best variant of a master playlist: { height, bandwidth, codec, hdr }; null for a plain media playlist
function bestVariant(text) {
    let best = null, m;
    const re = /#EXT-X-STREAM-INF:([^\n]*)/g;
    while ((m = re.exec(text))) {
        const attrs = m[1];
        const v = {
            height: Number((attrs.match(/RESOLUTION=\d+x(\d+)/) || [])[1]) || 0,
            bandwidth: Number((attrs.match(/(?:^|,)BANDWIDTH=(\d+)/) || [])[1]) || 0,
            codec: codecName((attrs.match(/CODECS="([^"]*)"/) || [])[1] || ''),
            hdr: /dvh[1e]/.test(attrs) ? 'Dolby Vision' : ({ PQ: 'HDR10', HLG: 'HLG' })[(attrs.match(/VIDEO-RANGE=(\w+)/) || [])[1]],
        };
        if (!best || v.height > best.height || (v.height === best.height && v.bandwidth > best.bandwidth)) best = v;
    }
    return best;
}

async function playlistInfo(stream) {
    try {
        const res = await send(stream.url, { headers: Object.assign({ 'User-Agent': UA }, stream.headers) });
        if (!res.ok) {
            console.error(`[quality] playlist answered HTTP ${res.status}`);
            return null;
        }
        const best = bestVariant(String(await res.text()));
        if (!best) console.error('[quality] playlist lists no variants');
        return best;
    } catch (e) {
        console.error(`[quality] ${e.message}`);
        return null;
    }
}

// MP4 size from a HEAD request (no body, unlike a range request that a server may ignore)
async function fileSize(stream) {
    try {
        const res = await send(stream.url, { method: 'HEAD', headers: Object.assign({ 'User-Agent': UA }, stream.headers) });
        const bytes = res.ok && Number(res.headers.get('content-length'));
        return bytes > 1e6 ? bytes : null;
    } catch (e) {
        return null;
    }
}

async function addDetails(streams) {
    const pending = streams.slice(0, 4).filter(s => /\.m3u8|\/hls|master/i.test(s.url) || /\.mp4(\?|$)/i.test(s.url) || s.quality === 'HLS' || s.quality === 'MP4');
    if (!pending.length) return;
    if (deadline - Date.now() < 8000) {
        console.error(`[quality] skipped, only ${Math.max(0, Math.round((deadline - Date.now()) / 1000))}s of the time budget left`);
        return;
    }
    await Promise.all(pending.map(async s => {
        const add = [];
        if (s.quality === 'MP4' || (/\.mp4(\?|$)/i.test(s.url) && !/\.m3u8/i.test(s.url))) {
            const bytes = await fileSize(s);
            if (bytes) add.push(gigabytes(bytes));
        } else {
            const v = await playlistInfo(s);
            if (!v) return;
            if (v.height && s.quality === 'HLS') s.quality = `${v.height}p`;
            add.push(v.codec, v.bandwidth && mbit(v.bandwidth), v.hdr);
        }
        const extra = add.filter(t => t && !String(s.title || '').includes(t));
        if (extra.length) s.title = [s.title].concat(extra).filter(Boolean).join(' · ');
    }));
}

export function provider(getStreams) {
    return {
        async getStreams(tmdbId, mediaType, season, episode) {
            deadline = Date.now() + DEADLINE_MS;
            // Nuvio's "Test provider" passes 'series' where playback passes 'tv'
            if (mediaType !== 'movie') mediaType = 'tv';
            let streams = [];
            try {
                streams = (await getStreams(tmdbId, mediaType, season, episode)) || [];
            } catch (e) {
                console.error(e.message);
            }
            if (running) await new Promise(resolve => idle.push(resolve));
            // German dub first, then German subtitles, then the rest; within a group the provider's own order stays
            const rank = lang => (lang === 'Deutsch' ? 0 : /dt\. UT|OmU/.test(lang) ? 1 : 2);
            const sorted = streams.map(decorate).map((d, i) => [rank(d.lang), i, d.stream]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(d => d[2]);
            await addDetails(sorted);
            if (running) await new Promise(resolve => idle.push(resolve));
            return sorted;
        },
    };
}

export async function request(url, opts = {}) {
    const res = await send(url, Object.assign({}, opts, { headers: Object.assign({ 'User-Agent': UA }, opts.headers) }));
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
    return res;
}

export const getText = async (url, opts) => (await request(url, opts)).text();

export const getJson = async (url, opts) => JSON.parse(await getText(url, opts));

export const postJson = (url, body, opts = {}) => getJson(url, Object.assign({}, opts, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: Object.assign({ 'Content-Type': 'application/json' }, opts.headers),
}));

export const postForm = (url, form, opts = {}) => getText(url, Object.assign({}, opts, {
    method: 'POST',
    body: Object.keys(form).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(form[k])).join('&'),
    headers: Object.assign({ 'Content-Type': 'application/x-www-form-urlencoded' }, opts.headers),
}));

export function absolute(url, base) {
    if (!url) return url;
    if (url.startsWith('//')) return 'https:' + url;
    if (/^https?:/.test(url)) return url;
    const origin = base.match(/^https?:\/\/[^/]+/)[0];
    return url.startsWith('/') ? origin + url : base.replace(/[^/]*$/, '') + url;
}
