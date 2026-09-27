package bd.mediwish.web;

import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.InvalidMediaTypeException;
import org.springframework.http.MediaType;
import org.springframework.security.web.util.matcher.RequestMatcher;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.Reader;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

/** Bounds the JSON bodies of the credential routes: registration, sign-in and the staff MFA routes. */
final class AuthRequestBodyLimitFilter extends OncePerRequestFilter {
    static final int MAX_BODY_BYTES = 16 * 1024;

    private final RequestMatcher routes;
    private final ApiErrors errors;

    AuthRequestBodyLimitFilter(RequestMatcher routes, ApiErrors errors) {
        this.routes = routes;
        this.errors = errors;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !routes.matches(request) || !isJsonContentType(request.getContentType());
    }

    private static boolean isJsonContentType(String contentType) {
        if (contentType == null) return false;
        try {
            MediaType mediaType = MediaType.parseMediaType(contentType);
            String subtype = mediaType.getSubtype().toLowerCase(Locale.ROOT);
            return "application".equalsIgnoreCase(mediaType.getType())
                    && ("json".equals(subtype) || subtype.endsWith("+json"));
        } catch (InvalidMediaTypeException exception) {
            return false;
        }
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    jakarta.servlet.FilterChain chain) throws ServletException, IOException {
        if (request.getContentLengthLong() > MAX_BODY_BYTES) {
            reject(request, response);
            return;
        }

        byte[] body = request.getInputStream().readNBytes(MAX_BODY_BYTES + 1);
        if (body.length > MAX_BODY_BYTES) {
            reject(request, response);
            return;
        }
        chain.doFilter(new CachedBodyRequest(request, body), response);
    }

    private void reject(HttpServletRequest request, HttpServletResponse response) throws IOException {
        errors.write(ApiError.INVALID_REQUEST, request, response);
    }

    private static final class CachedBodyRequest extends HttpServletRequestWrapper {
        private final byte[] body;

        private CachedBodyRequest(HttpServletRequest request, byte[] body) {
            super(request);
            this.body = body;
        }

        @Override
        public ServletInputStream getInputStream() {
            return new ByteArrayServletInputStream(body);
        }

        @Override
        public BufferedReader getReader() {
            Charset charset = getCharacterEncoding() == null
                    ? StandardCharsets.UTF_8 : Charset.forName(getCharacterEncoding());
            Reader reader = new InputStreamReader(getInputStream(), charset);
            return new BufferedReader(reader);
        }

        @Override
        public int getContentLength() {
            return body.length;
        }

        @Override
        public long getContentLengthLong() {
            return body.length;
        }
    }

    private static final class ByteArrayServletInputStream extends ServletInputStream {
        private final ByteArrayInputStream delegate;

        private ByteArrayServletInputStream(byte[] body) {
            this.delegate = new ByteArrayInputStream(body);
        }

        @Override
        public int read() {
            return delegate.read();
        }

        @Override
        public int read(byte[] buffer, int offset, int length) {
            return delegate.read(buffer, offset, length);
        }

        @Override
        public boolean isFinished() {
            return delegate.available() == 0;
        }

        @Override
        public boolean isReady() {
            return true;
        }

        @Override
        public void setReadListener(ReadListener listener) {
            throw new UnsupportedOperationException("async body reads are not supported");
        }
    }
}
