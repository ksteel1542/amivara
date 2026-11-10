import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'features/auth/auth_providers.dart';
import 'features/auth/otp_screen.dart';
import 'features/auth/phone_screen.dart';
import 'features/home/home_screen.dart';
import 'features/onboarding/basics_screen.dart';
import 'features/onboarding/dob_screen.dart';
import 'features/onboarding/not_eligible_screen.dart';
import 'features/onboarding/welcome_screen.dart';

/// Routes for sprint 1. Each onboarding step redirects to the start if the
/// state it depends on is missing (e.g. a cold start on /dob).
GoRouter buildRouter(WidgetRef ref, {String initialLocation = '/'}) {
  return GoRouter(
    initialLocation: initialLocation,
    redirect: (context, state) {
      final flow = ref.read(signupFlowProvider);
      final signedIn = ref.read(sessionProvider) != null;
      return switch (state.matchedLocation) {
        '/home' when !signedIn => '/',
        '/' || '/phone' when signedIn => '/home',
        '/otp' when flow.challenge == null => '/phone',
        '/dob' when flow.signupToken == null => '/',
        '/basics' when flow.signupToken == null || flow.dateOfBirth == null => '/',
        _ => null,
      };
    },
    routes: <RouteBase>[
      GoRoute(path: '/', builder: (_, _) => const WelcomeScreen()),
      GoRoute(path: '/phone', builder: (_, _) => const PhoneScreen()),
      GoRoute(path: '/otp', builder: (_, _) => const OtpScreen()),
      GoRoute(path: '/dob', builder: (_, _) => const DobScreen()),
      GoRoute(path: '/not-eligible', builder: (_, _) => const NotEligibleScreen()),
      GoRoute(path: '/basics', builder: (_, _) => const BasicsScreen()),
      GoRoute(path: '/home', builder: (_, _) => const HomeScreen()),
    ],
  );
}
