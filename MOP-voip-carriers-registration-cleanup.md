# Method of Procedure: Cleanup Invalid VoIP Carrier Registration Data

**Date:** 2026-02-07
**System:** jambonz SBC
**Component:** voip_carriers / sbc-sip-sidecar

---

## 1. Problem Statement

The `voip_carriers` table contains invalid `register_sip_realm` values that are causing malformed SIP REGISTER requests. These invalid registrations:

- Generate malformed SIP messages (e.g., `REGISTER sip:Switch`, `REGISTER sip:6001`)
- Consume system resources unnecessarily
- Will never succeed in registering

### Examples of Invalid REGISTER Requests Observed

```
REGISTER sip:6001 SIP/2.0
REGISTER sip:Switch SIP/2.0
REGISTER sip:asterisk SIP/2.0
REGISTER sip:España SIP/2.0
```

### Data Quality Summary

| Issue | Count | Impact |
|-------|------:|--------|
| `register_sip_realm` is empty string | 903 | Malformed REGISTER with empty URI |
| `register_sip_realm` has invalid value (not a domain) | 1,626 | Malformed REGISTER requests |
| Valid realm but missing username or password | 762 | Cannot authenticate |
| **Total affected carriers** | **~3,290** | Failed registrations |

---

## 2. Resolution Strategy

| Step | Action | Carriers Affected |
|------|--------|------------------:|
| 1 | Convert empty string realms to NULL (allows fallback to gateway IP) | 903 |
| 2 | Set realm to NULL for carriers with complete credentials + valid gateway | ~64 |
| 3 | Disable registration for carriers with invalid realm + missing data | ~1,568 |
| 4 | Disable registration for carriers with valid realm but missing credentials | 762 |

---

## 3. Pre-Execution: Data Gathering

### 3.1 Verify Current State

```sql
SELECT
  COUNT(*) as total_requires_register,
  SUM(CASE WHEN register_sip_realm IS NULL THEN 1 ELSE 0 END) as realm_null,
  SUM(CASE WHEN register_sip_realm = '' THEN 1 ELSE 0 END) as realm_empty,
  SUM(CASE WHEN register_sip_realm IS NOT NULL
           AND register_sip_realm != ''
           AND register_sip_realm NOT LIKE '%.%' THEN 1 ELSE 0 END) as realm_invalid,
  SUM(CASE WHEN register_sip_realm LIKE '%.%' THEN 1 ELSE 0 END) as realm_valid
FROM voip_carriers
WHERE requires_register = 1;
```

### 3.2 View Invalid Realm Values

```sql
SELECT register_sip_realm, COUNT(*) as cnt
FROM voip_carriers
WHERE requires_register = 1
  AND register_sip_realm IS NOT NULL
  AND register_sip_realm NOT LIKE '%.%'
GROUP BY register_sip_realm
ORDER BY cnt DESC
LIMIT 50;
```

### 3.3 Breakdown of Invalid Realm Carriers

```sql
SELECT
  COUNT(*) as total,
  SUM(CASE WHEN sg.ipv4 IS NOT NULL THEN 1 ELSE 0 END) as has_gateway_ip,
  SUM(CASE WHEN sg.ipv4 IS NULL THEN 1 ELSE 0 END) as no_gateway_ip,
  SUM(CASE WHEN vc.register_username IS NOT NULL
           AND vc.register_username != '' THEN 1 ELSE 0 END) as has_username,
  SUM(CASE WHEN vc.register_username IS NULL
           OR vc.register_username = '' THEN 1 ELSE 0 END) as no_username,
  SUM(CASE WHEN vc.register_password IS NOT NULL
           AND vc.register_password != '' THEN 1 ELSE 0 END) as has_password,
  SUM(CASE WHEN vc.register_password IS NULL
           OR vc.register_password = '' THEN 1 ELSE 0 END) as no_password
FROM voip_carriers vc
LEFT JOIN sip_gateways sg ON sg.voip_carrier_sid = vc.voip_carrier_sid AND sg.outbound = 1
WHERE vc.requires_register = 1
  AND vc.register_sip_realm IS NOT NULL
  AND vc.register_sip_realm NOT LIKE '%.%';
```

---

## 4. Pre-Execution: Create Backups

**Run these BEFORE making any changes.**

### 4.1 Backup Carriers That Will Have Realm Set to NULL

```sql
tee /tmp/carriers_realm_set_null.tsv
SELECT vc.voip_carrier_sid, vc.name, vc.account_sid, vc.register_sip_realm,
       vc.register_username, vc.register_password, sg.ipv4, sg.port,
       a.name as account_name
FROM voip_carriers vc
JOIN sip_gateways sg ON sg.voip_carrier_sid = vc.voip_carrier_sid AND sg.outbound = 1
LEFT JOIN accounts a ON a.account_sid = vc.account_sid
WHERE vc.requires_register = 1
  AND vc.register_sip_realm IS NOT NULL
  AND vc.register_sip_realm NOT LIKE '%.%'
  AND sg.ipv4 IS NOT NULL
  AND vc.register_username IS NOT NULL AND vc.register_username != ''
  AND vc.register_password IS NOT NULL AND vc.register_password != '';
notee
```

### 4.2 Backup Carriers That Will Have Registration Disabled

```sql
tee /tmp/carriers_registration_disabled.tsv
SELECT vc.voip_carrier_sid, vc.name, vc.account_sid, vc.register_sip_realm,
       vc.register_username, vc.register_password, sg.sip_gateway_sid,
       sg.ipv4, sg.port, a.name as account_name
FROM voip_carriers vc
LEFT JOIN sip_gateways sg ON sg.voip_carrier_sid = vc.voip_carrier_sid AND sg.outbound = 1
LEFT JOIN accounts a ON a.account_sid = vc.account_sid
WHERE vc.requires_register = 1
  AND vc.register_sip_realm IS NOT NULL
  AND vc.register_sip_realm NOT LIKE '%.%'
  AND NOT (
    sg.ipv4 IS NOT NULL
    AND vc.register_username IS NOT NULL AND vc.register_username != ''
    AND vc.register_password IS NOT NULL AND vc.register_password != ''
  );
notee
```

### 4.3 Full Backup of All Affected Carriers (Invalid Realm)

```sql
tee /tmp/carriers_all_invalid_realm_backup.tsv
SELECT vc.voip_carrier_sid, vc.name, vc.account_sid, vc.service_provider_sid,
       vc.requires_register, vc.register_sip_realm, vc.register_username,
       vc.register_password, vc.register_from_user, vc.register_from_domain,
       sg.sip_gateway_sid, sg.ipv4, sg.port, sg.protocol,
       a.name as account_name
FROM voip_carriers vc
LEFT JOIN sip_gateways sg ON sg.voip_carrier_sid = vc.voip_carrier_sid AND sg.outbound = 1
LEFT JOIN accounts a ON a.account_sid = vc.account_sid
WHERE vc.requires_register = 1
  AND vc.register_sip_realm IS NOT NULL
  AND vc.register_sip_realm NOT LIKE '%.%';
notee
```

### 4.4 Backup Carriers with Missing Credentials

```sql
tee /tmp/carriers_missing_credentials.tsv
SELECT vc.voip_carrier_sid, vc.name, vc.account_sid, vc.register_sip_realm,
       vc.register_username, vc.register_password, sg.ipv4, sg.port,
       a.name as account_name
FROM voip_carriers vc
LEFT JOIN sip_gateways sg ON sg.voip_carrier_sid = vc.voip_carrier_sid AND sg.outbound = 1
LEFT JOIN accounts a ON a.account_sid = vc.account_sid
WHERE vc.requires_register = 1
  AND (vc.register_sip_realm IS NULL OR vc.register_sip_realm LIKE '%.%')
  AND (
    vc.register_username IS NULL OR vc.register_username = ''
    OR vc.register_password IS NULL OR vc.register_password = ''
  );
notee
```

---

## 5. Execution: Update Scripts

**Run these IN ORDER after all backups are complete.**

### 5.1 Convert Empty String Realms to NULL

```sql
-- Preview
SELECT COUNT(*) as will_update FROM voip_carriers WHERE register_sip_realm = '';

-- Execute
UPDATE voip_carriers
SET register_sip_realm = NULL
WHERE register_sip_realm = '';
```

### 5.2 Set Realm to NULL for Carriers with Complete Credentials

This allows carriers with valid gateway IP, username, and password to attempt registration using the gateway IP as the realm.

```sql
-- Preview
SELECT COUNT(*) as will_update
FROM voip_carriers vc
JOIN sip_gateways sg ON sg.voip_carrier_sid = vc.voip_carrier_sid AND sg.outbound = 1
WHERE vc.requires_register = 1
  AND vc.register_sip_realm IS NOT NULL
  AND vc.register_sip_realm NOT LIKE '%.%'
  AND sg.ipv4 IS NOT NULL
  AND vc.register_username IS NOT NULL AND vc.register_username != ''
  AND vc.register_password IS NOT NULL AND vc.register_password != '';

-- Execute
UPDATE voip_carriers vc
JOIN sip_gateways sg ON sg.voip_carrier_sid = vc.voip_carrier_sid AND sg.outbound = 1
SET vc.register_sip_realm = NULL
WHERE vc.requires_register = 1
  AND vc.register_sip_realm IS NOT NULL
  AND vc.register_sip_realm NOT LIKE '%.%'
  AND sg.ipv4 IS NOT NULL
  AND vc.register_username IS NOT NULL AND vc.register_username != ''
  AND vc.register_password IS NOT NULL AND vc.register_password != '';
```

### 5.3 Disable Registration for Remaining Invalid Carriers

These carriers are missing essential data (gateway IP, username, or password) and cannot successfully register regardless of realm value.

```sql
-- Preview
SELECT COUNT(*) as will_disable
FROM voip_carriers
WHERE requires_register = 1
  AND register_sip_realm IS NOT NULL
  AND register_sip_realm NOT LIKE '%.%';

-- Execute
UPDATE voip_carriers
SET requires_register = 0
WHERE requires_register = 1
  AND register_sip_realm IS NOT NULL
  AND register_sip_realm NOT LIKE '%.%';
```

### 5.4 Disable Registration for Carriers with Missing Credentials

These carriers have a valid realm (or null) but are missing username or password, so they cannot authenticate.

```sql
-- Preview
SELECT COUNT(*) as will_disable
FROM voip_carriers
WHERE requires_register = 1
  AND (register_sip_realm IS NULL OR register_sip_realm LIKE '%.%')
  AND (
    register_username IS NULL OR register_username = ''
    OR register_password IS NULL OR register_password = ''
  );

-- Execute
UPDATE voip_carriers
SET requires_register = 0
WHERE requires_register = 1
  AND (register_sip_realm IS NULL OR register_sip_realm LIKE '%.%')
  AND (
    register_username IS NULL OR register_username = ''
    OR register_password IS NULL OR register_password = ''
  );
```

---

## 6. Post-Execution: Verification

### 6.1 Confirm No Invalid Realms Remain

```sql
SELECT COUNT(*) as should_be_zero
FROM voip_carriers
WHERE requires_register = 1
  AND register_sip_realm IS NOT NULL
  AND register_sip_realm NOT LIKE '%.%';
```

**Expected result: 0**

### 6.2 Confirm No Missing Credentials Remain

```sql
SELECT COUNT(*) as should_be_zero
FROM voip_carriers
WHERE requires_register = 1
  AND (
    register_username IS NULL OR register_username = ''
    OR register_password IS NULL OR register_password = ''
  );
```

**Expected result: 0**

### 6.3 Verify Registration Summary

```sql
SELECT
  COUNT(*) as total_requires_register,
  SUM(CASE WHEN register_sip_realm IS NULL THEN 1 ELSE 0 END) as realm_null_uses_gateway_ip,
  SUM(CASE WHEN register_sip_realm LIKE '%.%' THEN 1 ELSE 0 END) as realm_valid_domain
FROM voip_carriers
WHERE requires_register = 1;
```

### 6.4 Monitor System Logs

After sbc-sip-sidecar picks up the changes (next refresh cycle), verify:

- No more malformed REGISTER requests (`sip:Switch`, `sip:asterisk`, `sip:6001`, etc.)
- Reduced "duplicate gateway" warning messages
- Successful registrations for carriers that had complete credentials

---

## 7. Rollback Procedures

If issues arise, use the backup files to restore original values.

### 7.1 Restore Realm Values (Rollback Step 5.2)

```sql
-- For each row in /tmp/carriers_realm_set_null.tsv:
UPDATE voip_carriers
SET register_sip_realm = '<original_value_from_backup>'
WHERE voip_carrier_sid = '<voip_carrier_sid_from_backup>';
```

### 7.2 Re-enable Registration (Rollback Step 5.3)

```sql
-- For each row in /tmp/carriers_registration_disabled.tsv:
UPDATE voip_carriers
SET requires_register = 1
WHERE voip_carrier_sid = '<voip_carrier_sid_from_backup>';
```

### 7.3 Re-enable Registration (Rollback Step 5.4)

```sql
-- For each row in /tmp/carriers_missing_credentials.tsv:
UPDATE voip_carriers
SET requires_register = 1
WHERE voip_carrier_sid = '<voip_carrier_sid_from_backup>';
```

---

## 8. Summary

| Step | Action | Carriers | Status |
|------|--------|----------|--------|
| 5.1 | Empty realm → NULL | 903 | ☐ |
| 5.2 | Invalid realm → NULL (complete credentials) | ~64 | ☐ |
| 5.3 | Invalid realm → disable registration | ~1,568 | ☐ |
| 5.4 | Missing credentials → disable registration | 762 | ☐ |
| 6.1 | Verify no invalid realms | - | ☐ |
| 6.2 | Verify no missing credentials | - | ☐ |
| 6.3 | Verify registration summary | - | ☐ |

**Total carriers cleaned up: ~3,297**

---

## 9. Appendix: Root Cause

Invalid data was entered into the `register_sip_realm` field, including:

- PBX software names: `asterisk`, `3CXPhoneSystem`, `Switch`
- Random strings/passwords: `Fign4Gc6`, `yvRb6p28E5Gi`
- Usernames/extensions: `1002`, `0033972160812`
- Company names: `ChangebridgeMedical`, `AptivaMedical`
- Country names: `España`
- Wildcards: `*`

**Recommendations:**
- Add input validation in the jambonz API to reject invalid `register_sip_realm` values on create/update operations
- Require `register_username` and `register_password` when `requires_register` is set to true