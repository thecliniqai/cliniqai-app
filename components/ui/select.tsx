"use client";

import React from "react";
import { NativeSelect } from "./native-select";

/**
 * v1 `Select` (V2-06 06-02a adapter): the v1 props (`invalid` + every native `<select>` attribute) over
 * `NativeSelect`, so the v1 call sites keep compiling and render the approved skin. New code imports `NativeSelect`.
 */
export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(function Select(props, ref) {
  return <NativeSelect ref={ref} {...props} />;
});

Select.displayName = "Select";
