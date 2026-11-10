-- Smoke test for the hand-written CHECK constraints. Run by CI against a
-- fresh PostGIS database after `prisma migrate deploy`. Every block must
-- raise check_violation; anything else fails the job (ON_ERROR_STOP).
\set ON_ERROR_STOP on

DO $$
BEGIN
  -- Under 18 must be rejected.
  BEGIN
    INSERT INTO users (id, phone_e164, date_of_birth, updated_at)
    VALUES (gen_random_uuid(), '+2348000000001', CURRENT_DATE - INTERVAL '17 years', now());
    RAISE EXCEPTION 'users_adult_chk did not reject an under-18 date of birth';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'ok: users_adult_chk rejects under-18';
  END;

  -- Exactly 18 today must be accepted.
  INSERT INTO users (id, phone_e164, date_of_birth, updated_at)
  VALUES (gen_random_uuid(), '+2348000000002', CURRENT_DATE - INTERVAL '18 years', now());
  RAISE NOTICE 'ok: users_adult_chk accepts an 18th birthday today';

  -- Unordered match pair must be rejected.
  BEGIN
    INSERT INTO matches (id, user_a_id, user_b_id)
    VALUES (gen_random_uuid(), 'ffffffff-ffff-4fff-bfff-ffffffffffff', '00000000-0000-4000-8000-000000000000');
    RAISE EXCEPTION 'matches_pair_order_chk did not reject an unordered pair';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'ok: matches_pair_order_chk rejects unordered pairs';
  END;
END
$$;

-- Preferences can never go below 18 (PRD §4).
DO $$
DECLARE
  adult uuid;
BEGIN
  SELECT id INTO adult FROM users WHERE phone_e164 = '+2348000000002';

  BEGIN
    INSERT INTO preferences (user_id, interested_in, age_min, age_max, updated_at)
    VALUES (adult, ARRAY['WOMAN']::gender[], 17, 30, now());
    RAISE EXCEPTION 'preferences_age_chk did not reject age_min 17';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'ok: preferences_age_chk rejects age_min below 18';
  END;

  BEGIN
    INSERT INTO preferences (user_id, interested_in, age_min, age_max, updated_at)
    VALUES (adult, ARRAY[]::gender[], 18, 30, now());
    RAISE EXCEPTION 'preferences_interested_in_chk did not reject an empty list';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'ok: preferences_interested_in_chk rejects an empty list';
  END;

  INSERT INTO preferences (user_id, interested_in, age_min, age_max, updated_at)
  VALUES (adult, ARRAY['WOMAN', 'MAN']::gender[], 18, 40, now());
  RAISE NOTICE 'ok: valid preferences accepted';
END
$$;

-- Profile limits and photo slots (sprint 2).
DO $$
DECLARE
  adult uuid;
BEGIN
  SELECT id INTO adult FROM users WHERE phone_e164 = '+2348000000002';
  INSERT INTO profiles (user_id, first_name, gender, intent, updated_at)
  VALUES (adult, 'Test', 'WOMAN', 'RELATIONSHIP', now());

  BEGIN
    UPDATE profiles SET prompts = '[1,2,3,4,5,6]'::jsonb WHERE user_id = adult;
    RAISE EXCEPTION 'profiles_prompts_chk did not reject 6 prompts';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'ok: profiles_prompts_chk rejects more than 5 prompts';
  END;

  BEGIN
    UPDATE profiles SET height_cm = 90 WHERE user_id = adult;
    RAISE EXCEPTION 'profiles_height_chk did not reject 90 cm';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'ok: profiles_height_chk rejects an implausible height';
  END;

  BEGIN
    INSERT INTO profile_photos (id, user_id, storage_key, content_type, status, position)
    VALUES (gen_random_uuid(), adult, 'photos/x/1.jpg', 'image/jpeg', 'UPLOADED', 6);
    RAISE EXCEPTION 'profile_photos_position_chk did not reject slot 6';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'ok: profile_photos_position_chk allows only slots 0-5';
  END;

  BEGIN
    INSERT INTO profile_photos (id, user_id, storage_key, content_type, status, position)
    VALUES (gen_random_uuid(), adult, 'photos/x/2.gif', 'image/gif', 'UPLOADED', 0);
    RAISE EXCEPTION 'profile_photos_content_type_chk did not reject a GIF';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'ok: profile_photos_content_type_chk allows JPEG/WebP only';
  END;

  BEGIN
    INSERT INTO profile_photos (id, user_id, storage_key, content_type, status, position)
    VALUES (gen_random_uuid(), adult, 'photos/x/3.jpg', 'image/jpeg', 'PENDING_UPLOAD', 0);
    RAISE EXCEPTION 'profile_photos_pending_position_chk did not reject a pending photo holding a slot';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'ok: pending uploads never hold a slot';
  END;
END
$$;

-- PostGIS is installed and the spatial index exists.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'profiles_location_gist_idx') THEN
    RAISE EXCEPTION 'profiles_location_gist_idx is missing';
  END IF;
  PERFORM ST_DWithin('SRID=4326;POINT(3.3792 6.5244)'::geography, 'SRID=4326;POINT(7.4951 9.0579)'::geography, 600000);
  RAISE NOTICE 'ok: PostGIS geography + GiST index present';
END
$$;
