// A rule file added to a rules directory is picked up without editing any list (tests/ci/ui-policy.spec.ts).
export default {
  id: "fixture-extra",
  mode: "report",
  reason: "fixture rule: reports every file once",
  check(file) {
    return [{ line: 1, detail: `seen ${file}` }];
  },
};
