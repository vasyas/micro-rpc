export type DeepPartial<T> = {
  [P in keyof T]?: DeepPartial<T[P]>
}

export function deepOverride<T>(
  destination: DeepPartial<T>,
  source: DeepPartial<T>
): DeepPartial<T> {
  for (const property of Object.keys(source)) {
    if (
      typeof source[property] == "object" &&
      source[property] != null &&
      !(source[property] instanceof Date) &&
      !Array.isArray(source[property])
    ) {
      destination[property] = destination[property] || {}
      deepOverride(destination[property], source[property])
    } else {
      destination[property] = source[property]
    }
  }

  return destination
}
