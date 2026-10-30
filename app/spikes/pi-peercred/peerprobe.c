// Synthetic Linux-only feasibility probe. This is not a production broker.
#define _GNU_SOURCE
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/un.h>
#include <unistd.h>

static const char *path = "/ipc/peer.sock";

static int connect_socket(void) {
  int fd = socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0);
  if (fd < 0) return -1;
  struct sockaddr_un address = { .sun_family = AF_UNIX };
  snprintf(address.sun_path, sizeof(address.sun_path), "%s", path);
  if (connect(fd, (struct sockaddr *)&address, sizeof(address)) != 0) { close(fd); return -1; }
  return fd;
}

static int serve(void) {
  int listener = socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0);
  if (listener < 0) return 1;
  struct sockaddr_un address = { .sun_family = AF_UNIX };
  snprintf(address.sun_path, sizeof(address.sun_path), "%s", path);
  if (bind(listener, (struct sockaddr *)&address, sizeof(address)) != 0 || chmod(path, 0666) != 0 || listen(listener, 4) != 0) { perror("listen"); return 1; }
  puts("READY"); fflush(stdout);
  for (int i = 0; i < 3; i++) {
    int fd = accept4(listener, NULL, NULL, SOCK_CLOEXEC);
    if (fd < 0) { perror("accept"); return 1; }
    struct ucred peer; socklen_t size = sizeof(peer);
    if (getsockopt(fd, SOL_SOCKET, SO_PEERCRED, &peer, &size) != 0 || size != sizeof(peer)) { close(fd); return 1; }
    const int allowed = peer.uid == 1002;
    const char *result = allowed ? "allowed\n" : "denied\n";
    if (write(fd, result, strlen(result)) != (ssize_t)strlen(result)) { close(fd); return 1; }
    printf("peer uid=%lu result=%s", (unsigned long)peer.uid, result); fflush(stdout);
    close(fd);
  }
  close(listener);
  return 0;
}

static int client(const char *expected) {
  int fd = connect_socket();
  if (fd < 0) { perror("connect"); return 1; }
  char reply[16] = {0}; ssize_t n = read(fd, reply, sizeof(reply) - 1); close(fd);
  if (n < 0 || strcmp(reply, expected) != 0) { fprintf(stderr, "Unexpected response\n"); return 1; }
  printf("client uid=%lu result=%s", (unsigned long)getuid(), reply);
  return 0;
}

int main(int argc, char **argv) {
  if (argc == 2 && strcmp(argv[1], "server") == 0) return serve();
  if (argc == 3 && strcmp(argv[1], "client") == 0 && strcmp(argv[2], "allowed") == 0) return client("allowed\n");
  if (argc == 3 && strcmp(argv[1], "client") == 0 && strcmp(argv[2], "denied") == 0) return client("denied\n");
  return 2;
}
