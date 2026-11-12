import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api_client.dart';
import '../../theme/rose_tokens.g.dart';
import '../auth/auth_providers.dart';
import '../profile/profile_models.dart';
import '../profile/profile_providers.dart';
import 'preferences_repository.dart';

/// Discovery preferences: who to show, age range and distance (PATCH /me/preferences),
/// plus the interests and languages on your profile (PATCH /profiles/me).
class PreferencesScreen extends ConsumerStatefulWidget {
  const PreferencesScreen({super.key});

  @override
  ConsumerState<PreferencesScreen> createState() => _PreferencesScreenState();
}

class _PreferencesScreenState extends ConsumerState<PreferencesScreen> {
  ProfileCatalog? _catalog;
  Set<SeekGender> _seek = <SeekGender>{};
  RangeValues _ages = const RangeValues(22, 32);
  double _distance = 50;
  List<String> _interests = <String>[];
  List<String> _languages = <String>[];
  String? _error;
  bool _loaded = false;
  bool _saving = false;

  String get _token => ref.read(sessionProvider)!.accessToken;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final profiles = ref.read(profileRepositoryProvider);
      final results = await Future.wait<Object>(<Future<Object>>[
        ref.read(preferencesRepositoryProvider).get(_token),
        profiles.catalog(_token),
        profiles.myProfile(_token),
      ]);
      if (!mounted) return;
      final prefs = results[0] as DiscoveryPreferences;
      final profile = results[2] as MyProfile;
      setState(() {
        _catalog = results[1] as ProfileCatalog;
        _seek = Set.of(prefs.interestedIn);
        _ages = RangeValues(prefs.ageMin.toDouble(), prefs.ageMax.toDouble());
        _distance = prefs.maxDistanceKm.toDouble();
        _interests = List.of(profile.interests);
        _languages = List.of(profile.languages);
        _loaded = true;
        _error = null;
      });
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  void _toggle(List<String> list, String id, int max, String what) {
    setState(() {
      if (list.contains(id)) {
        list.remove(id);
      } else if (list.length < max) {
        list.add(id);
      } else {
        ScaffoldMessenger.of(context)
          ..hideCurrentSnackBar()
          ..showSnackBar(SnackBar(content: Text('You can choose up to $max $what.')));
      }
    });
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    try {
      await ref
          .read(preferencesRepositoryProvider)
          .update(
            _token,
            DiscoveryPreferences(
              interestedIn: _seek,
              ageMin: _ages.start.round(),
              ageMax: _ages.end.round(),
              maxDistanceKm: _distance.round(),
            ),
          );
      await ref.read(profileRepositoryProvider).updateTags(_token, interests: _interests, languages: _languages);
      if (!mounted) return;
      final messenger = ScaffoldMessenger.of(context);
      if (context.canPop()) context.pop();
      messenger.showSnackBar(const SnackBar(content: Text('Preferences saved. Discovery will use them right away.')));
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final catalog = _catalog;
    if (!_loaded || catalog == null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Discovery preferences')),
        body: Center(
          child: _error == null
              ? const CircularProgressIndicator()
              : Column(
                  mainAxisSize: MainAxisSize.min,
                  children: <Widget>[
                    Text(_error!),
                    const SizedBox(height: RoseSpacing.s3),
                    OutlinedButton(onPressed: _load, child: const Text('Try again')),
                  ],
                ),
        ),
      );
    }

    final canSave = _seek.isNotEmpty && !_saving;
    return Scaffold(
      appBar: AppBar(title: const Text('Discovery preferences')),
      body: ListView(
        key: const Key('preferences-list'),
        padding: const EdgeInsets.fromLTRB(RoseSpacing.s4, RoseSpacing.s2, RoseSpacing.s4, RoseSpacing.s8),
        children: <Widget>[
          _Section('Show me'),
          Wrap(
            spacing: RoseSpacing.s2,
            children: <Widget>[
              for (final g in SeekGender.values)
                FilterChip(
                  key: Key('seek-${g.api}'),
                  label: Text(g.label),
                  selected: _seek.contains(g),
                  onSelected: (on) => setState(() => on ? _seek.add(g) : _seek.remove(g)),
                ),
            ],
          ),
          if (_seek.isEmpty)
            Padding(
              padding: const EdgeInsets.only(top: RoseSpacing.s1),
              child: Text(
                'Choose at least one.',
                key: const Key('seek-error'),
                style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.error),
              ),
            ),
          _Section('Age range', trailing: '${_ages.start.round()}–${_ages.end.round()}'),
          RangeSlider(
            key: const Key('age-range'),
            values: _ages,
            min: DiscoveryPreferences.ageFloor.toDouble(),
            max: DiscoveryPreferences.ageCeiling.toDouble(),
            divisions: DiscoveryPreferences.ageCeiling - DiscoveryPreferences.ageFloor,
            labels: RangeLabels('${_ages.start.round()}', '${_ages.end.round()}'),
            onChanged: (v) => setState(() => _ages = v),
          ),
          Text('AMIVARA is for adults only: 18 is the youngest anyone can be.', style: theme.textTheme.bodySmall),
          _Section('Maximum distance', trailing: '${_distance.round()} km'),
          Slider(
            key: const Key('distance'),
            value: _distance,
            min: DiscoveryPreferences.minDistanceKm.toDouble(),
            max: DiscoveryPreferences.maxDistanceLimitKm.toDouble(),
            divisions: DiscoveryPreferences.maxDistanceLimitKm - DiscoveryPreferences.minDistanceKm,
            label: '${_distance.round()} km',
            onChanged: (v) => setState(() => _distance = v),
          ),
          _Section('Interests', trailing: '${_interests.length}/${catalog.maxInterests}'),
          Text(
            'Shown on your profile, and they help us find people you will get on with.',
            style: theme.textTheme.bodySmall,
          ),
          const SizedBox(height: RoseSpacing.s2),
          Wrap(
            spacing: RoseSpacing.s2,
            runSpacing: RoseSpacing.s1,
            children: <Widget>[
              for (final id in catalog.interests)
                FilterChip(
                  key: Key('interest-$id'),
                  label: Text(interestLabel(id)),
                  selected: _interests.contains(id),
                  onSelected: (_) => _toggle(_interests, id, catalog.maxInterests, 'interests'),
                ),
            ],
          ),
          _Section('Languages you speak', trailing: '${_languages.length}/${catalog.maxLanguages}'),
          Wrap(
            spacing: RoseSpacing.s2,
            runSpacing: RoseSpacing.s1,
            children: <Widget>[
              for (final l in catalog.languages)
                FilterChip(
                  key: Key('language-${l.code}'),
                  label: Text(l.name),
                  selected: _languages.contains(l.code),
                  onSelected: (_) => _toggle(_languages, l.code, catalog.maxLanguages, 'languages'),
                ),
            ],
          ),
          const SizedBox(height: RoseSpacing.s6),
          SizedBox(
            height: RoseSpacing.buttonPrimaryHeight,
            child: FilledButton(
              key: const Key('save-preferences'),
              onPressed: canSave ? _save : null,
              child: _saving
                  ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2))
                  : const Text('Save'),
            ),
          ),
        ],
      ),
    );
  }
}

class _Section extends StatelessWidget {
  const _Section(this.title, {this.trailing});

  final String title;
  final String? trailing;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.only(top: RoseSpacing.s6, bottom: RoseSpacing.s2),
      child: Row(
        children: <Widget>[
          Expanded(child: Text(title, style: theme.textTheme.titleMedium)),
          if (trailing != null)
            Text(trailing!, style: theme.textTheme.titleSmall?.copyWith(color: theme.colorScheme.primary)),
        ],
      ),
    );
  }
}
