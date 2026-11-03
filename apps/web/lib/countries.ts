export interface CountryOption {
  code: string;
  name: string;
}

/** Built on the server and passed down: Node and browsers name and sort a few countries differently. */
export function countryOptions(): CountryOption[] {
  const names = new Intl.DisplayNames(["en"], { type: "region" });
  const out: CountryOption[] = [];
  for (let a = 65; a <= 90; a++) {
    for (let b = 65; b <= 90; b++) {
      const code = String.fromCharCode(a, b);
      const name = names.of(code);
      if (name && name !== code && !/^(EU|UN|EZ|QO|XA|XB|AC|CP|DG|EA|IC|TA|UK|DD|SU|YU|BU|CS|FX|TP|ZR|AN)$/.test(code)) out.push({ code, name });
    }
  }
  return out.sort((x, y) => x.name.localeCompare(y.name));
}
