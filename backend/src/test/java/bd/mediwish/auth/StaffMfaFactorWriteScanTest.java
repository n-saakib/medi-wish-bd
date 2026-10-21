package bd.mediwish.auth;

import org.junit.jupiter.api.Test;
import org.springframework.asm.AnnotationVisitor;
import org.springframework.asm.ClassReader;
import org.springframework.asm.ClassVisitor;
import org.springframework.asm.MethodVisitor;
import org.springframework.asm.SpringAsmInfo;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * R1 (Ticket 09 T6): only the backup-code replacement may revoke an active staff factor, so a mobile or email password
 * recovery (Tickets 04 and 05) cannot remove MFA. Scans the compiled production classes; no Spring context or database.
 */
class StaffMfaFactorWriteScanTest {
    private static final Pattern FACTOR_WRITE =
            Pattern.compile("(?i)\\b(update|delete\\s+from)\\s+(staff_mfa_factors|StaffMfaFactor)\\b");

    @Test
    void onlyTheReplacementRevokesAFactorAndOnlyPendingRowsAreBulkDeleted() throws Exception {
        Path classes = Path.of(StaffMfaFactor.class.getProtectionDomain().getCodeSource().getLocation().toURI());
        var revokers = new ArrayList<String>();
        var factorWrites = new ArrayList<String>();
        try (var files = Files.walk(classes)) {
            for (Path file : files.filter(path -> path.toString().endsWith(".class")).toList()) {
                new ClassReader(Files.readAllBytes(file))
                        .accept(new FactorWriteScanner(revokers, factorWrites), ClassReader.SKIP_FRAMES);
            }
        }
        assertThat(revokers).singleElement().asString()
                .startsWith("bd/mediwish/auth/StaffMfaRecoveryService.lambda$verifyReplacement$");
        // The one bulk factor write deletes only an unverified pending enrollment.
        assertThat(factorWrites).singleElement().asString()
                .contains("StaffMfaFactorRepository.deletePending").contains("Status.PENDING");
    }

    /** Records each production method that calls StaffMfaFactor.revoke, and each query string that writes factor rows. */
    private static final class FactorWriteScanner extends ClassVisitor {
        private final List<String> revokers;
        private final List<String> factorWrites;
        private String owner;

        FactorWriteScanner(List<String> revokers, List<String> factorWrites) {
            super(SpringAsmInfo.ASM_VERSION);
            this.revokers = revokers;
            this.factorWrites = factorWrites;
        }

        @Override
        public void visit(int version, int access, String name, String signature, String superName, String[] interfaces) {
            owner = name;
        }

        @Override
        public MethodVisitor visitMethod(int access, String method, String descriptor, String signature, String[] exceptions) {
            String where = owner + "." + method;
            return new MethodVisitor(SpringAsmInfo.ASM_VERSION) {
                @Override
                public void visitMethodInsn(int opcode, String target, String name, String desc, boolean isInterface) {
                    if (target.equals("bd/mediwish/auth/StaffMfaFactor") && name.equals("revoke")) revokers.add(where);
                }

                @Override
                public void visitLdcInsn(Object value) {
                    record(where, value);
                }

                @Override
                public AnnotationVisitor visitAnnotation(String annotation, boolean visible) {
                    return new AnnotationVisitor(SpringAsmInfo.ASM_VERSION) {
                        @Override
                        public void visit(String name, Object value) {
                            record(where, value);
                        }
                    };
                }
            };
        }

        private void record(String where, Object value) {
            if (value instanceof String text && FACTOR_WRITE.matcher(text).find()) factorWrites.add(where + ": " + text);
        }
    }
}
