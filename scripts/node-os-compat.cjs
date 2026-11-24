// Node 24 can fail os.userInfo() in constrained Windows sessions.
process.geteuid = process.geteuid || (() => 0);
