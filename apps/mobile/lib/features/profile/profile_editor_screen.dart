import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api_client.dart';
import '../../theme/rose_tokens.g.dart';
import '../../widgets/onboarding_scaffold.dart';
import '../auth/auth_providers.dart';
import '../auth/auth_repository.dart';
import 'photo_grid.dart';
import 'profile_models.dart';
import 'profile_providers.dart';

const Map<DatingIntent, String> _intentLabels = <DatingIntent, String>{
  DatingIntent.relationship: 'A relationship',
  DatingIntent.friendship: 'Friendship',
  DatingIntent.casual: 'Something casual',
  DatingIntent.notSure: 'Not sure yet',
};

/// Profile editor: photo grid (2–6, drag to reorder), bio, intent and prompts (max 5).
/// In [onboarding] mode it is step 5 of sign-up and continues to the Smile ID explainer.
class ProfileEditorScreen extends ConsumerStatefulWidget {
  const ProfileEditorScreen({super.key, this.onboarding = false, this.imageBuilder});

  final bool onboarding;

  /// Test hook: replaces network images.
  final PhotoImageBuilder? imageBuilder;

  @override
  ConsumerState<ProfileEditorScreen> createState() => _ProfileEditorScreenState();
}

class _ProfileEditorScreenState extends ConsumerState<ProfileEditorScreen> {
  final _bio = TextEditingController();
  ProfileCatalog? _catalog;
  List<ProfilePhoto> _photos = <ProfilePhoto>[];
  List<PromptAnswer> _prompts = <PromptAnswer>[];
  DatingIntent? _intent;
  bool _loading = true;
  bool _uploading = false;
  bool _saving = false;
  String? _error;

  String get _token => ref.read(sessionProvider)!.accessToken;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _bio.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    final repo = ref.read(profileRepositoryProvider);
    try {
      final (catalog, profile) = await (repo.catalog(_token), repo.myProfile(_token)).wait;
      if (!mounted) return;
      setState(() {
        _catalog = catalog;
        _photos = profile.photos;
        _prompts = profile.prompts;
        _intent = profile.intent;
        _bio.text = profile.bio ?? '';
        _loading = false;
      });
    } on ParallelWaitError<(ProfileCatalog?, MyProfile?), (AsyncError?, AsyncError?)> catch (e) {
      final cause = e.errors.$1?.error ?? e.errors.$2?.error;
      if (mounted) setState(() => _error = cause is ApiException ? cause.message : 'Could not load your profile.');
    }
  }

  Future<void> _run(Future<List<ProfilePhoto>> Function() action) async {
    try {
      final photos = await action();
      if (mounted) setState(() => _photos = photos);
    } on ApiException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  Future<void> _addPhoto() async {
    final bytes = await ref.read(photoProcessorProvider).pickAndCompress();
    if (bytes == null) return;
    setState(() => _uploading = true);
    await _run(() => ref.read(profileRepositoryProvider).uploadPhoto(_token, bytes));
    if (mounted) setState(() => _uploading = false);
  }

  Future<void> _reorder(List<String> ids) async {
    final previous = _photos;
    // Optimistic: show the new order at once, roll back if the API refuses.
    setState(() => _photos = <ProfilePhoto>[for (final id in ids) previous.firstWhere((p) => p.id == id)]);
    try {
      final photos = await ref.read(profileRepositoryProvider).reorderPhotos(_token, ids);
      if (mounted) setState(() => _photos = photos);
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => _photos = previous);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  Future<void> _photoActions(ProfilePhoto photo) async {
    final action = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            if (!photo.isPrimary)
              ListTile(
                leading: const Icon(Icons.star_outline),
                title: const Text('Make main photo'),
                onTap: () => Navigator.pop(context, 'primary'),
              ),
            ListTile(
              leading: const Icon(Icons.delete_outline),
              title: const Text('Remove photo'),
              onTap: () => Navigator.pop(context, 'delete'),
            ),
          ],
        ),
      ),
    );
    final repo = ref.read(profileRepositoryProvider);
    if (action == 'primary') await _run(() => repo.makePrimary(_token, photo.id));
    if (action == 'delete') await _run(() => repo.deletePhoto(_token, photo.id));
  }

  Future<void> _editPrompt({PromptAnswer? existing}) async {
    final catalog = _catalog!;
    final used = _prompts.map((p) => p.promptId).toSet()..remove(existing?.promptId);
    final promptId =
        existing?.promptId ??
        await showModalBottomSheet<String>(
          context: context,
          showDragHandle: true,
          isScrollControlled: true,
          builder: (context) => SafeArea(
            child: ListView(
              shrinkWrap: true,
              children: <Widget>[
                for (final option in catalog.prompts.where((o) => !used.contains(o.id)))
                  ListTile(title: Text(option.text), onTap: () => Navigator.pop(context, option.id)),
              ],
            ),
          ),
        );
    if (promptId == null || !mounted) return;

    final answer = await showDialog<String>(
      context: context,
      builder: (context) => _PromptAnswerDialog(prompt: catalog.promptText(promptId), initial: existing?.answer ?? ''),
    );
    if (answer == null || answer.isEmpty) return;
    setState(() {
      final updated = PromptAnswer(promptId, answer);
      final index = _prompts.indexWhere((p) => p.promptId == promptId);
      _prompts = index >= 0 ? (List.of(_prompts)..[index] = updated) : <PromptAnswer>[..._prompts, updated];
    });
  }

  Future<void> _save() async {
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await ref
          .read(profileRepositoryProvider)
          .updateProfile(_token, bio: _bio.text.trim(), intent: _intent, prompts: _prompts);
      if (!mounted) return;
      if (widget.onboarding) {
        context.go('/verify-intro');
      } else {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Profile saved')));
        if (context.canPop()) context.pop();
      }
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final catalog = _catalog;
    if (_loading || catalog == null) {
      return Scaffold(
        appBar: AppBar(),
        body: Center(child: _error == null ? const CircularProgressIndicator() : ErrorBanner(message: _error!)),
      );
    }

    final theme = Theme.of(context);
    final enoughPhotos = _photos.length >= catalog.minPhotos;
    Widget section(String text) => Padding(
      padding: const EdgeInsets.only(top: RoseSpacing.s8, bottom: RoseSpacing.s2),
      child: Text(text, style: theme.textTheme.titleMedium),
    );

    return OnboardingScaffold(
      step: 5,
      showBack: !widget.onboarding,
      title: widget.onboarding ? 'Add your photos' : 'Edit profile',
      subtitle:
          'Add ${catalog.minPhotos}–${catalog.maxPhotos} photos. Long-press to reorder; the first is your main photo.',
      primaryLabel: widget.onboarding ? 'Continue' : 'Save',
      primaryBusy: _saving,
      onPrimary: enoughPhotos && !_uploading ? _save : null,
      children: <Widget>[
        PhotoGrid(
          photos: _photos,
          maxPhotos: catalog.maxPhotos,
          uploading: _uploading,
          onReorder: _reorder,
          onAdd: _addPhoto,
          onPhotoTap: _photoActions,
          imageBuilder: widget.imageBuilder ?? _defaultImage,
        ),
        if (!enoughPhotos)
          Padding(
            padding: const EdgeInsets.only(top: RoseSpacing.s2),
            child: Text(
              'Add at least ${catalog.minPhotos} photos to continue.',
              style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
          ),
        section('About you'),
        TextField(
          key: const Key('bio'),
          controller: _bio,
          maxLines: 4,
          maxLength: catalog.maxBio,
          decoration: const InputDecoration(hintText: 'A few lines about you'),
        ),
        section("I'm looking for"),
        Wrap(
          spacing: RoseSpacing.s2,
          runSpacing: RoseSpacing.s2,
          children: <Widget>[
            for (final intent in DatingIntent.values)
              ChoiceChip(
                label: Text(_intentLabels[intent]!),
                selected: _intent == intent,
                onSelected: (_) => setState(() => _intent = intent),
              ),
          ],
        ),
        section('Prompts (${_prompts.length}/${catalog.maxPrompts})'),
        for (final prompt in _prompts)
          Card(
            child: ListTile(
              title: Text(catalog.promptText(prompt.promptId), style: theme.textTheme.labelLarge),
              subtitle: Text(prompt.answer),
              onTap: () => _editPrompt(existing: prompt),
              trailing: IconButton(
                tooltip: 'Remove prompt',
                icon: const Icon(Icons.close),
                onPressed: () => setState(() => _prompts = _prompts.where((p) => p != prompt).toList()),
              ),
            ),
          ),
        if (_prompts.length < catalog.maxPrompts)
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton.icon(
              key: const Key('add-prompt'),
              onPressed: _editPrompt,
              icon: const Icon(Icons.add),
              label: const Text('Add a prompt'),
            ),
          ),
        if (_error != null) ...<Widget>[const SizedBox(height: RoseSpacing.s4), ErrorBanner(message: _error!)],
      ],
    );
  }

  static Widget _defaultImage(BuildContext context, ProfilePhoto photo) => Image.network(
    photo.url,
    fit: BoxFit.cover,
    errorBuilder: (context, error, stack) => const ColoredBox(color: Colors.black12),
  );
}

/// Owns its TextEditingController, so it is disposed only after the dialog's
/// closing animation has finished with the field.
class _PromptAnswerDialog extends StatefulWidget {
  const _PromptAnswerDialog({required this.prompt, required this.initial});

  final String prompt;
  final String initial;

  @override
  State<_PromptAnswerDialog> createState() => _PromptAnswerDialogState();
}

class _PromptAnswerDialogState extends State<_PromptAnswerDialog> {
  late final TextEditingController _controller = TextEditingController(text: widget.initial);

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(widget.prompt, style: Theme.of(context).textTheme.titleMedium),
      content: TextField(
        key: const Key('prompt-answer'),
        controller: _controller,
        autofocus: true,
        maxLines: 3,
        inputFormatters: <TextInputFormatter>[LengthLimitingTextInputFormatter(150)],
        decoration: const InputDecoration(hintText: 'Your answer'),
      ),
      actions: <Widget>[
        TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
        FilledButton(onPressed: () => Navigator.pop(context, _controller.text.trim()), child: const Text('Done')),
      ],
    );
  }
}
