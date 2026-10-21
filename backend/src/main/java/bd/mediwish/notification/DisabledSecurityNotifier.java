package bd.mediwish.notification;

public class DisabledSecurityNotifier implements SecurityNotifier {
    @Override public NoticeOutcome send(SecurityNotice notice) { return NoticeOutcome.NOT_CONFIGURED; }
}
