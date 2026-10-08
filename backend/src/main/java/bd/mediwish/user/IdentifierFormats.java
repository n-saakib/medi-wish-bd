package bd.mediwish.user;

import java.util.regex.Pattern;

/** Accepted registration and profile identifier formats, applied after normalization. */
public final class IdentifierFormats {
    private static final Pattern USERNAME = Pattern.compile("(?=.*[a-z])[a-z0-9._-]{3,20}");
    private static final Pattern MOBILE = Pattern.compile("[0-9]{11}");
    private static final String ATEXT = "[a-z0-9!#$%&'*+/=?^_`{|}~-]";
    private static final String LABEL = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
    private static final Pattern EMAIL = Pattern.compile(ATEXT + "+(?:\\." + ATEXT + "+)*@" + LABEL + "(?:\\." + LABEL + ")+");

    private IdentifierFormats() {}

    public static boolean isUsername(String value) {
        return value != null && USERNAME.matcher(value).matches();
    }

    public static boolean isMobile(String value) {
        return value != null && MOBILE.matcher(value).matches();
    }

    public static boolean isEmail(String value) {
        if (value == null || value.length() > 254 || !EMAIL.matcher(value).matches()) return false;
        return value.indexOf('@') <= 64;
    }
}
