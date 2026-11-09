# AMIVARA: Security, Safety & Privacy

**Status:** Draft v0.1 · **Regulatory baseline:** Nigeria Data Protection Act 2023 (NDPA), GAID 2025, Apple/Google dating-app policies

## 1. Age assurance (18+ only)

AMIVARA is strictly for adults. We use layered age assurance:

1. **Self-declaration at signup.** The member enters their DOB. If it puts them under 18, signup is refused, and the phone hash and device fingerprint are blocked from trying again for 12 months.
2. **Database constraint.** `users.date_of_birth` has a `CHECK` that requires the person to be at least 18. The API also validates this, so the rule holds even if one layer has a bug.
3. **Document and liveness verification.** No member can like, message or appear in discovery until a KYC provider confirms that their ID document shows them as 18+ and that a liveness selfie matches the document.
4. **Mismatch handling.** If the DOB on the verified ID doesn't match the declared DOB, the account is held for manual review. If the ID shows an age under 18, the account is banned immediately and its data is purged, keeping only the minimum evidence needed for legal reporting.
5. **Ongoing signals.** Member reports of "underage suspicion" suspend the account automatically until a priority review. The target is under 1 hour, 24/7.
6. **Preference floor.** Nobody can set `age_min` below 18 (enforced in the API and the DB).

Child-safety reporting: any content involving apparent minors is escalated, preserved for law enforcement, and reported to the relevant authorities and NCMEC/IWF.

## 2. Phone verification

- E.164 normalisation. One account per phone number.
- 6-digit OTP, 5-minute expiry, single use, stored only as a salted hash.
- Limits: 3 sends per 10 minutes and 10 per day for each phone, device and IP. Lock out after 5 wrong codes.
- SIM-swap and recycled-number defences: the provider's line-status check where it's available, plus re-verification when a new device logs in.
- Virtual (VoIP) numbers are blocked where the provider can detect them.

## 3. Authentication & sessions

- The access JWT (15 minutes) is signed with asymmetric keys (ES256) that rotate every quarter.
- Refresh tokens are opaque, stored only as a hash, rotate on every use, and trigger revocation of the whole session family if one is reused.
- Members can see and revoke their device sessions.
- Admins sign in through SSO with mandatory MFA, from an IP allowlist or VPN.

## 4. Privacy controls (member-facing)

| Control | Behaviour |
|---|---|
| Approximate distance | Distance is shown rounded (minimum "< 2 km") and never as coordinates. Stored location is rounded to about 100 m. Small random noise stops trilateration. |
| Pause profile | Removes the member from discovery immediately. |
| Incognito | Only people the member has liked can see them. |
| Hide optional fields | Religion, education, job and height are hidden unless the member fills them in. |
| Read receipts and typing indicators | Can be turned off. |
| Block / report | Available in every profile and chat. |
| Data export | A machine-readable export within 30 days (NDPA access right). |
| Delete account | A 30-day soft delete, then permanent erasure from the primary DB. Backups age out within 35 days. |

## 5. Data handling rules

**Data minimisation**
- We never store raw ID document images or the full NIN. We keep only the provider reference, pass/fail result, verified age band and timestamp.
- We store only the latest location, rounded, with no history.
- IP addresses are hashed with a rotating salt in logs.

**Classification**
| Class | Examples | Handling |
|---|---|---|
| Highly sensitive | Verification results, sexual orientation (implied by gender preferences), messages, precise location | Encrypted at rest. Access is logged and requires a reason. Never sent to analytics. |
| Sensitive | Phone, DOB, photos | Encrypted at rest. Only the roles that need it can access it. |
| Internal | Aggregate metrics | Pseudonymised. |

**Encryption**
- TLS 1.2+ everywhere, with HSTS. Mobile apps pin certificates to the API's public keys.
- AES-256 at rest (database, backups, object storage). Application-level encryption for message bodies and verification metadata, with keys in a KMS.
- Media buckets are private. Access is only through signed URLs that last 10 minutes or less.

**Access**
- Least privilege and role-based access. No production DB access from laptops, only through a bastion with session recording.
- Every staff access to a member's data is written to the `audit_log`.

**Third parties**
- Every processor (KYC, SMS, push, cloud, analytics) has a Data Processing Agreement. Where data leaves Nigeria, the transfer is assessed under NDPA Part VIII.
- Analytics SDKs receive no PII and no sexual-orientation data.

**Retention**
| Data | Retention |
|---|---|
| Messages | Kept while the match is active, then deleted 30 days after unmatch or account deletion (unless there's a legal hold or an open report) |
| Reports and enforcement records | 3 years |
| OTP logs | 30 days |
| Application logs | 30 days (PII redacted) |

## 6. Content moderation

- Every photo is screened automatically for nudity, violence, minors and text or contact details, and goes to human review if it's flagged.
- Messages are screened for scam patterns (requests for money, links, crypto, "send airtime") and the member sees a warning.
- Moderators get wellbeing support, blurred previews by default, and a two-person rule for bans.

## 7. Application security

- OWASP ASVS Level 2 as the baseline. Threat model before the MVP.
- Input validation on every DTO. Parameterised queries only.
- Dependency scanning (Dependabot), SAST (CodeQL) and secret scanning in CI.
- An external penetration test before the Nigerian launch, and again every year.
- WAF and bot protection on the API gateway.
- An object-level authorisation test suite. Example: user A can never read B's conversation unless they're matched.

## 8. Incident response

- On-call rotation and severity levels (SEV1 to SEV3).
- Notify the NDPC within 72 hours of a qualifying personal data breach, and notify affected members without undue delay.
- A post-incident review within 5 business days.

## 9. Governance

- Appoint a Data Protection Officer and register with the NDPC as a data controller of major importance.
- Complete a Data Protection Impact Assessment (DPIA) before launch.
- Publish the privacy policy, community guidelines and a transparency report (every year).
