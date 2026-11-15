// UI policy fixture (06-08): the approved CliniQ AI raw names are findings everywhere; their semantic look-alikes are not.
export function Approved() {
  return (
    <div className="bg-mineral-50 text-primary-600 hover:bg-primary-700/90">
      <p className="border-teal-550 text-brass-700">raw brand names</p>
      <p className="bg-success-50 text-danger-600 ring-focus outline-focus-halo">raw state names</p>
      <p className="bg-success-bg text-danger-fg bg-danger-solid border-warning-border text-info-fg">semantic</p>
      <p className="ring-ring ring-ring-halo focus-visible:focus-ring bg-(--focus-ring-color) text-fg">semantic too</p>
    </div>
  );
}
