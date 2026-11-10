import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'chat_repository.dart';
import 'chat_socket.dart';

/// Overridden in main.dart and in tests.
final chatRepositoryProvider = Provider<ChatRepository>((ref) => throw UnimplementedError('override in main'));

/// A fresh socket per chat screen (the screen closes it).
final chatSocketFactoryProvider = Provider<ChatSocket Function()>((ref) => IoChatSocket.new);
