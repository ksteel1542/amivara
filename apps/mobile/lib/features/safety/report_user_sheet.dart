import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_client.dart';
import '../../theme/rose_tokens.g.dart';
import '../auth/auth_providers.dart';
import 'safety_repository.dart';

/// What the member did from the safety menu. Either way, they won't see
/// this person again, so the caller removes the card or closes the chat.
enum SafetyOutcome { reported, blocked }

/// "Safety & Report" menu for a discovery card or a chat: report (which also
/// blocks) or just block. Returns null if they backed out.
Future<SafetyOutcome?> showSafetyMenu(
  BuildContext context, {
  required String userId,
  required String firstName,
  String? messageId,
}) async {
  final choice = await showModalBottomSheet<String>(
    context: context,
    showDragHandle: true,
    builder: (context) => SafeArea(
      child: Column(
        key: const Key('safety-menu'),
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Padding(
            padding: const EdgeInsets.fromLTRB(RoseSpacing.s6, 0, RoseSpacing.s6, RoseSpacing.s2),
            child: Text('Safety & Report', style: Theme.of(context).textTheme.titleLarge),
          ),
          ListTile(
            key: const Key('safety-report'),
            leading: const Icon(Icons.flag_outlined),
            title: Text('Report $firstName'),
            subtitle: const Text("We'll review it. They won't know it was you."),
            onTap: () => Navigator.pop(context, 'report'),
          ),
          ListTile(
            key: const Key('safety-block'),
            leading: const Icon(Icons.block_rounded),
            title: Text('Block $firstName'),
            subtitle: const Text("You won't see each other on AMIVARA again."),
            onTap: () => Navigator.pop(context, 'block'),
          ),
          const SizedBox(height: RoseSpacing.s2),
        ],
      ),
    ),
  );
  if (!context.mounted || choice == null) return null;
  if (choice == 'report') {
    return showModalBottomSheet<SafetyOutcome>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => ReportUserSheet(userId: userId, firstName: firstName, messageId: messageId),
    );
  }
  return _confirmBlock(context, userId: userId, firstName: firstName);
}

Future<SafetyOutcome?> _confirmBlock(BuildContext context, {required String userId, required String firstName}) async {
  final confirmed = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      key: const Key('block-dialog'),
      title: Text('Block $firstName?'),
      content: const Text(
        "You won't see each other in discovery, and any match and chat between you will be removed. "
        "They aren't told.",
      ),
      actions: <Widget>[
        TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
        FilledButton(
          key: const Key('block-confirm'),
          style: FilledButton.styleFrom(backgroundColor: Theme.of(context).colorScheme.error),
          onPressed: () => Navigator.pop(context, true),
          child: const Text('Block'),
        ),
      ],
    ),
  );
  if (confirmed != true || !context.mounted) return null;
  final container = ProviderScope.containerOf(context, listen: false);
  try {
    await container.read(safetyRepositoryProvider).block(container.read(sessionProvider)!.accessToken, userId);
  } on ApiException catch (e) {
    if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    return null;
  }
  if (context.mounted) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$firstName is blocked.')));
  }
  return SafetyOutcome.blocked;
}

/// Pick a category, optionally say what happened, submit. Reporting also
/// blocks them. Pops with [SafetyOutcome.reported] once the report is in.
class ReportUserSheet extends ConsumerStatefulWidget {
  const ReportUserSheet({super.key, required this.userId, required this.firstName, this.messageId});

  final String userId;
  final String firstName;

  /// The message being reported, when opened from a chat bubble.
  final String? messageId;

  @override
  ConsumerState<ReportUserSheet> createState() => _ReportUserSheetState();
}

class _ReportUserSheetState extends ConsumerState<ReportUserSheet> {
  final TextEditingController _details = TextEditingController();
  ReportCategory? _category;
  bool _submitting = false;
  String? _error;

  @override
  void dispose() {
    _details.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final category = _category;
    if (category == null || _submitting) return;
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      await ref
          .read(safetyRepositoryProvider)
          .report(
            ref.read(sessionProvider)!.accessToken,
            userId: widget.userId,
            category: category,
            details: _details.text,
            messageId: widget.messageId,
          );
    } on ApiException catch (e) {
      if (mounted) {
        setState(() {
          _submitting = false;
          _error = e.message;
        });
      }
      return;
    }
    if (!mounted) return;
    final messenger = ScaffoldMessenger.of(context);
    Navigator.pop(context, SafetyOutcome.reported);
    messenger.showSnackBar(
      SnackBar(content: Text("Thanks for telling us. We'll review it, and you won't see ${widget.firstName} again.")),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final needsDetails = _category == ReportCategory.other;
    final canSubmit = _category != null && !_submitting && (!needsDetails || _details.text.trim().isNotEmpty);

    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: SafeArea(
        child: SingleChildScrollView(
          key: const Key('report-sheet'),
          padding: const EdgeInsets.fromLTRB(RoseSpacing.s6, 0, RoseSpacing.s6, RoseSpacing.s4),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Text('Report ${widget.firstName}', style: theme.textTheme.headlineSmall),
              const SizedBox(height: RoseSpacing.s1),
              Text(
                "What's going on? ${widget.firstName} won't know you reported them.",
                style: theme.textTheme.bodyMedium,
              ),
              const SizedBox(height: RoseSpacing.s2),
              RadioGroup<ReportCategory>(
                groupValue: _category,
                onChanged: (value) => setState(() => _category = value),
                child: Column(
                  children: <Widget>[
                    for (final c in ReportCategory.values)
                      RadioListTile<ReportCategory>(
                        key: Key('report-category-${c.apiValue}'),
                        value: c,
                        contentPadding: EdgeInsets.zero,
                        title: Text(c.label),
                        subtitle: Text(c.hint),
                      ),
                  ],
                ),
              ),
              const SizedBox(height: RoseSpacing.s2),
              TextField(
                key: const Key('report-details'),
                controller: _details,
                onChanged: (_) => setState(() {}),
                minLines: 2,
                maxLines: 5,
                maxLength: 1000,
                textCapitalization: TextCapitalization.sentences,
                decoration: InputDecoration(
                  labelText: needsDetails ? 'What happened? (required)' : 'Anything else? (optional)',
                  alignLabelWithHint: true,
                ),
              ),
              if (_category == ReportCategory.underage)
                Padding(
                  padding: const EdgeInsets.only(bottom: RoseSpacing.s2),
                  child: Text(
                    'AMIVARA is for adults only. Their account is paused while our team checks.',
                    key: const Key('report-underage-note'),
                    style: theme.textTheme.bodySmall,
                  ),
                ),
              if (_error != null)
                Padding(
                  padding: const EdgeInsets.only(bottom: RoseSpacing.s2),
                  child: Text(_error!, style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.error)),
                ),
              Text(
                'Reporting also blocks ${widget.firstName}: you won\'t see each other again.',
                style: theme.textTheme.bodySmall,
              ),
              const SizedBox(height: RoseSpacing.s3),
              SizedBox(
                height: RoseSpacing.buttonPrimaryHeight,
                child: FilledButton(
                  key: const Key('report-submit'),
                  onPressed: canSubmit ? _submit : null,
                  child: _submitting
                      ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2))
                      : const Text('Submit report'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
