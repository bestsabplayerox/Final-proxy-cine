export default async (request, context) => {
    const url = new URL(request.url);
    
    // 1. Extract the target URL from the path (e.g., /https://google.com)
    let path = url.pathname.substring(1) + url.search;
    

    path = path.replace(/^(https?:\/)([^\/])/, '$1/$2');

    let targetUrl;

    try {
        // Try to parse it as a valid URL
        targetUrl = new URL(path).href;
    } catch {
        // 2. FALLBACK If it's a relative link (like /api/data) missing the domain, make sure to check this cine

        const referer = request.headers.get("referer");
        if (referer) {
            try {
                const refUrl = new URL(referer);
                let refPath = refUrl.pathname.substring(1).replace(/^(https?:\/)([^\/])/, '$1/$2');
                if (refPath.startsWith("http")) {
                    const refTargetOrigin = new URL(refPath).origin;
                    targetUrl = new URL(path, refTargetOrigin).href;
                } else {
                    throw new Error("Invalid referer");
                }
            } catch (e) {
                return new Response("Invalid request path.", { status: 400 });
            }
        } else {
            return new Response("No URL provided. Usage: https://your-proxy.netlify.app/https://example.com", { status: 400 });
        }
    }

    try {

        const headers = new Headers(request.headers);
        headers.set("Host", new URL(targetUrl).host);
        headers.set("Origin", new URL(targetUrl).origin);
        headers.delete("Referer");

        const fetchOptions = {
            method: request.method,
            headers: headers,
            redirect: "manual" // We must handle redirects manually
        };


        if (["POST", "PUT", "PATCH"].includes(request.method)) {
            fetchOptions.body = request.body;
        }

        const response = await fetch(targetUrl, fetchOptions);
        const newHeaders = new Headers(response.headers);

        // 4. get redirects 
        if ([301, 302, 303, 307, 308].includes(response.status)) {
            const location = newHeaders.get("location");
            if (location) {
                const redirectUrl = new URL(location, targetUrl).href;
                newHeaders.set("location", `${url.origin}/${redirectUrl}`);
            }
        }

        // 5. we get the proxy
        newHeaders.delete("x-frame-options");
        newHeaders.delete("content-security-policy");
        newHeaders.delete("x-content-type-options");
        newHeaders.delete("strict-transport-security");
        newHeaders.set("access-control-allow-origin", "*");

        let body = response.body;

        // jj finish this part of the proxy
        const contentType = newHeaders.get("content-type") || "";
        if (contentType.includes("text/html")) {
            const text = await response.text();
            const baseTag = `<base href="${url.origin}/${targetUrl}">`;
            
            let modifiedHtml = text.replace(/<head>/i, `<head>\n${baseTag}`);
            // If the site has no <head>, just slap it at the top
            if (!modifiedHtml.includes(baseTag)) {
                modifiedHtml = baseTag + "\n" + modifiedHtml;
            }
            body = modifiedHtml;
            newHeaders.delete("content-length"); // Delete length because we changed the file size
        }

        return new Response(body, {
            status: response.status,
            headers: newHeaders,
        });

    } catch (error) {
        return new Response("Proxy error: " + error.message, { status: 500 });
    }
};
