-- Contact details held back from Chat House room chat are logged for Safety too.
ALTER TABLE "safety_events" DROP CONSTRAINT "safety_events_kind_chk";
ALTER TABLE "safety_events" ADD CONSTRAINT "safety_events_kind_chk"
  CHECK ("kind" IN ('CONTACT_SHARING', 'ROOM_CONTACT_SHARING'));
