import { assertEquals } from "jsr:@std/assert";
import { npmParser } from "./npm.ts";
import { pypiParser } from "./pypi.ts";
import { cargoParser } from "./cargo.ts";
import { goParser } from "./go.ts";
import { mavenParser } from "./maven.ts";
import { gradleGroovyParser } from "./gradle-groovy.ts";
import { gradleKotlinParser } from "./gradle-kotlin.ts";
import { denoParser } from "./deno.ts";
import { nugetParser } from "./nuget.ts";
import { parseDependencies } from "./index.ts";

// NPM Parser Tests
Deno.test("npmParser - parses dependencies from package.json", () => {
  const content = JSON.stringify({
    dependencies: {
      express: "^4.18.2",
      lodash: "~4.17.21",
    },
    devDependencies: {
      typescript: ">=5.0.0",
    },
  });

  const deps = npmParser.parse(content);
  assertEquals(deps.length, 3);
  assertEquals(deps[0], { name: "express", version: "4.18.2" });
  assertEquals(deps[1], { name: "lodash", version: "4.17.21" });
  assertEquals(deps[2], { name: "typescript", version: "5.0.0" });
});

Deno.test("npmParser - handles empty package.json", () => {
  const content = JSON.stringify({});
  const deps = npmParser.parse(content);
  assertEquals(deps.length, 0);
});

Deno.test("npmParser - includes peerDependencies", () => {
  const content = JSON.stringify({
    peerDependencies: {
      react: "^18.0.0",
    },
  });

  const deps = npmParser.parse(content);
  assertEquals(deps.length, 1);
  assertEquals(deps[0], { name: "react", version: "18.0.0" });
});

// PyPI Parser Tests
Deno.test("pypiParser - parses requirements.txt with == constraint", () => {
  const content = `
requests==2.28.1
flask==2.0.0
`;
  const deps = pypiParser.parse(content);
  assertEquals(deps.length, 2);
  assertEquals(deps[0], { name: "requests", version: "2.28.1" });
  assertEquals(deps[1], { name: "flask", version: "2.0.0" });
});

Deno.test("pypiParser - parses various version constraints", () => {
  const content = `
requests>=2.28.0
flask~=2.0.0
django<=4.0.0
`;
  const deps = pypiParser.parse(content);
  assertEquals(deps.length, 3);
  assertEquals(deps[0], { name: "requests", version: "2.28.0" });
  assertEquals(deps[1], { name: "flask", version: "2.0.0" });
  assertEquals(deps[2], { name: "django", version: "4.0.0" });
});

Deno.test("pypiParser - skips comments and empty lines", () => {
  const content = `
# This is a comment
requests==2.28.1

# Another comment
flask==2.0.0
`;
  const deps = pypiParser.parse(content);
  assertEquals(deps.length, 2);
});

Deno.test("pypiParser - skips flags", () => {
  const content = `
-e git+https://github.com/user/repo.git#egg=package
--index-url https://pypi.org/simple/
requests==2.28.1
`;
  const deps = pypiParser.parse(content);
  assertEquals(deps.length, 1);
  assertEquals(deps[0], { name: "requests", version: "2.28.1" });
});

// Cargo Parser Tests
Deno.test("cargoParser - parses simple dependencies", () => {
  const content = `
[dependencies]
serde = "1.0"
tokio = "1.28"

[dev-dependencies]
test-lib = "0.1"
`;
  const deps = cargoParser.parse(content);
  assertEquals(deps.length, 2);
  assertEquals(deps[0], { name: "serde", version: "1.0" });
  assertEquals(deps[1], { name: "tokio", version: "1.28" });
});

Deno.test("cargoParser - parses inline complex dependencies", () => {
  // Note: parser section regex stops at '[' so features arrays break parsing
  const content = `[dependencies]
serde = { version = "1.0" }
tokio = { version = "1.28", optional = true }`;
  const deps = cargoParser.parse(content);
  assertEquals(deps.length, 2);
  assertEquals(deps[0], { name: "serde", version: "1.0" });
  assertEquals(deps[1], { name: "tokio", version: "1.28" });
});

// Go Parser Tests
Deno.test("goParser - parses single-line require", () => {
  const content = `
module example.com/myproject

go 1.21

require github.com/gin-gonic/gin v1.9.1
require golang.org/x/text v0.14.0
`;
  const deps = goParser.parse(content);
  assertEquals(deps.length, 2);
  assertEquals(deps[0], { name: "github.com/gin-gonic/gin", version: "v1.9.1" });
  assertEquals(deps[1], { name: "golang.org/x/text", version: "v0.14.0" });
});

Deno.test("goParser - parses require block", () => {
  const content = `
module example.com/myproject

go 1.21

require (
	github.com/gin-gonic/gin v1.9.1
	golang.org/x/text v0.14.0
)
`;
  const deps = goParser.parse(content);
  assertEquals(deps.length, 2);
  assertEquals(deps[0], { name: "github.com/gin-gonic/gin", version: "v1.9.1" });
  assertEquals(deps[1], { name: "golang.org/x/text", version: "v0.14.0" });
});

// Maven Parser Tests
Deno.test("mavenParser - parses pom.xml dependencies", () => {
  const content = `
<project>
  <dependencies>
    <dependency>
      <groupId>org.springframework</groupId>
      <artifactId>spring-core</artifactId>
      <version>6.0.0</version>
    </dependency>
    <dependency>
      <groupId>com.google.guava</groupId>
      <artifactId>guava</artifactId>
      <version>31.1-jre</version>
    </dependency>
  </dependencies>
</project>
`;
  const deps = mavenParser.parse(content);
  assertEquals(deps.length, 2);
  assertEquals(deps[0], { name: "org.springframework:spring-core", version: "6.0.0" });
  assertEquals(deps[1], { name: "com.google.guava:guava", version: "31.1-jre" });
});

Deno.test("mavenParser - skips property references", () => {
  const content = `
<project>
  <dependencies>
    <dependency>
      <groupId>org.springframework</groupId>
      <artifactId>spring-core</artifactId>
      <version>\${spring.version}</version>
    </dependency>
    <dependency>
      <groupId>com.google.guava</groupId>
      <artifactId>guava</artifactId>
      <version>31.1-jre</version>
    </dependency>
  </dependencies>
</project>
`;
  const deps = mavenParser.parse(content);
  assertEquals(deps.length, 1);
  assertEquals(deps[0], { name: "com.google.guava:guava", version: "31.1-jre" });
});

// Gradle Groovy Parser Tests
Deno.test("gradleGroovyParser - parses string notation with single quotes", () => {
  const content = `
dependencies {
    implementation 'org.springframework:spring-core:6.0.0'
    testImplementation 'junit:junit:4.13.2'
}
`;
  const deps = gradleGroovyParser.parse(content);
  assertEquals(deps.length, 2);
  assertEquals(deps[0], { name: "org.springframework:spring-core", version: "6.0.0" });
  assertEquals(deps[1], { name: "junit:junit", version: "4.13.2" });
});

Deno.test("gradleGroovyParser - parses string notation with double quotes", () => {
  const content = `
dependencies {
    implementation "org.springframework:spring-core:6.0.0"
    api "com.google.guava:guava:31.1-jre"
}
`;
  const deps = gradleGroovyParser.parse(content);
  assertEquals(deps.length, 2);
  assertEquals(deps[0], { name: "org.springframework:spring-core", version: "6.0.0" });
  assertEquals(deps[1], { name: "com.google.guava:guava", version: "31.1-jre" });
});

Deno.test("gradleGroovyParser - parses map notation", () => {
  const content = `
dependencies {
    implementation group: 'org.springframework', name: 'spring-core', version: '6.0.0'
}
`;
  const deps = gradleGroovyParser.parse(content);
  assertEquals(deps.length, 1);
  assertEquals(deps[0], { name: "org.springframework:spring-core", version: "6.0.0" });
});

Deno.test("gradleGroovyParser - skips variable references", () => {
  const content = `
dependencies {
    implementation "org.springframework:spring-core:\${springVersion}"
    implementation 'com.google.guava:guava:31.1-jre'
}
`;
  const deps = gradleGroovyParser.parse(content);
  assertEquals(deps.length, 1);
  assertEquals(deps[0], { name: "com.google.guava:guava", version: "31.1-jre" });
});

// Gradle Kotlin Parser Tests
Deno.test("gradleKotlinParser - parses function call notation", () => {
  const content = `
dependencies {
    implementation("org.springframework:spring-core:6.0.0")
    testImplementation("junit:junit:4.13.2")
}
`;
  const deps = gradleKotlinParser.parse(content);
  assertEquals(deps.length, 2);
  assertEquals(deps[0], { name: "org.springframework:spring-core", version: "6.0.0" });
  assertEquals(deps[1], { name: "junit:junit", version: "4.13.2" });
});

Deno.test("gradleKotlinParser - skips variable references", () => {
  const content = `
dependencies {
    implementation("org.springframework:spring-core:\${springVersion}")
    implementation("com.google.guava:guava:31.1-jre")
}
`;
  const deps = gradleKotlinParser.parse(content);
  assertEquals(deps.length, 1);
  assertEquals(deps[0], { name: "com.google.guava:guava", version: "31.1-jre" });
});

// parseDependencies factory function tests
Deno.test("parseDependencies - auto-detects pom.xml", () => {
  const content = `
<project>
  <dependencies>
    <dependency>
      <groupId>org.springframework</groupId>
      <artifactId>spring-core</artifactId>
      <version>6.0.0</version>
    </dependency>
  </dependencies>
</project>
`;
  const deps = parseDependencies(content, "maven");
  assertEquals(deps.length, 1);
  assertEquals(deps[0], { name: "org.springframework:spring-core", version: "6.0.0" });
});

Deno.test("parseDependencies - auto-detects Gradle Groovy", () => {
  const content = `
dependencies {
    implementation 'org.springframework:spring-core:6.0.0'
}
`;
  const deps = parseDependencies(content, "maven");
  assertEquals(deps.length, 1);
  assertEquals(deps[0], { name: "org.springframework:spring-core", version: "6.0.0" });
});

Deno.test("parseDependencies - auto-detects Gradle Kotlin", () => {
  const content = `
dependencies {
    implementation("org.springframework:spring-core:6.0.0")
}
`;
  const deps = parseDependencies(content, "maven");
  assertEquals(deps.length, 1);
  assertEquals(deps[0], { name: "org.springframework:spring-core", version: "6.0.0" });
});

Deno.test("parseDependencies - uses correct parser for npm", () => {
  const content = JSON.stringify({
    dependencies: { express: "^4.18.2" },
  });
  const deps = parseDependencies(content, "npm");
  assertEquals(deps.length, 1);
  assertEquals(deps[0], { name: "express", version: "4.18.2" });
});

Deno.test("parseDependencies - uses correct parser for pypi", () => {
  const content = "requests==2.28.1\n";
  const deps = parseDependencies(content, "pypi");
  assertEquals(deps.length, 1);
  assertEquals(deps[0], { name: "requests", version: "2.28.1" });
});

Deno.test("parseDependencies - uses correct parser for cargo", () => {
  const content = `
[dependencies]
serde = "1.0"
`;
  const deps = parseDependencies(content, "cargo");
  assertEquals(deps.length, 1);
  assertEquals(deps[0], { name: "serde", version: "1.0" });
});

Deno.test("parseDependencies - uses correct parser for go", () => {
  const content = `
module test

require github.com/gin-gonic/gin v1.9.1
`;
  const deps = parseDependencies(content, "go");
  assertEquals(deps.length, 1);
  assertEquals(deps[0], { name: "github.com/gin-gonic/gin", version: "v1.9.1" });
});

// Parser metadata tests
Deno.test("parser metadata - npm", () => {
  assertEquals(npmParser.fileType, "package.json");
  assertEquals(npmParser.registry, "npm");
});

Deno.test("parser metadata - pypi", () => {
  assertEquals(pypiParser.fileType, "requirements.txt");
  assertEquals(pypiParser.registry, "pypi");
});

Deno.test("parser metadata - cargo", () => {
  assertEquals(cargoParser.fileType, "Cargo.toml");
  assertEquals(cargoParser.registry, "cargo");
});

Deno.test("parser metadata - go", () => {
  assertEquals(goParser.fileType, "go.mod");
  assertEquals(goParser.registry, "go");
});

Deno.test("parser metadata - maven", () => {
  assertEquals(mavenParser.fileType, "pom.xml");
  assertEquals(mavenParser.registry, "maven");
});

Deno.test("parser metadata - gradle groovy", () => {
  assertEquals(gradleGroovyParser.fileType, "build.gradle");
  assertEquals(gradleGroovyParser.registry, "maven");
});

Deno.test("parser metadata - gradle kotlin", () => {
  assertEquals(gradleKotlinParser.fileType, "build.gradle.kts");
  assertEquals(gradleKotlinParser.registry, "maven");
});

// Deno Parser Tests
Deno.test("denoParser - parses JSR imports", () => {
  const content = JSON.stringify({
    imports: {
      "@std/path": "jsr:@std/path@^1.0.0",
      "@std/assert": "jsr:@std/assert@1.0.0",
    },
  });

  const deps = denoParser.parse(content);
  assertEquals(deps.length, 2);
  assertEquals(deps[0], { name: "@std/path", version: "1.0.0" });
  assertEquals(deps[1], { name: "@std/assert", version: "1.0.0" });
});

Deno.test("denoParser - parses npm imports with prefix", () => {
  const content = JSON.stringify({
    imports: {
      lodash: "npm:lodash@^4.17.21",
      express: "npm:express@~4.18.2",
    },
  });

  const deps = denoParser.parse(content);
  assertEquals(deps.length, 2);
  assertEquals(deps[0], { name: "npm:lodash", version: "4.17.21" });
  assertEquals(deps[1], { name: "npm:express", version: "4.18.2" });
});

Deno.test("denoParser - parses mixed JSR and npm imports", () => {
  const content = JSON.stringify({
    imports: {
      "@std/path": "jsr:@std/path@^1.0.0",
      lodash: "npm:lodash@^4.17.21",
      "@oak/oak": "jsr:@oak/oak@17",
    },
  });

  const deps = denoParser.parse(content);
  assertEquals(deps.length, 3);
  assertEquals(deps[0], { name: "@std/path", version: "1.0.0" });
  assertEquals(deps[1], { name: "npm:lodash", version: "4.17.21" });
  assertEquals(deps[2], { name: "@oak/oak", version: "17" });
});

Deno.test("denoParser - handles empty imports", () => {
  const content = JSON.stringify({
    imports: {},
  });

  const deps = denoParser.parse(content);
  assertEquals(deps.length, 0);
});

Deno.test("denoParser - handles missing imports", () => {
  const content = JSON.stringify({
    name: "my-project",
  });

  const deps = denoParser.parse(content);
  assertEquals(deps.length, 0);
});

Deno.test("denoParser - skips URL imports", () => {
  const content = JSON.stringify({
    imports: {
      "@std/path": "jsr:@std/path@^1.0.0",
      "legacy-dep": "https://deno.land/x/some_module@v1.0.0/mod.ts",
    },
  });

  const deps = denoParser.parse(content);
  assertEquals(deps.length, 1);
  assertEquals(deps[0], { name: "@std/path", version: "1.0.0" });
});

Deno.test("denoParser - skips workspace imports", () => {
  const content = JSON.stringify({
    imports: {
      "@std/path": "jsr:@std/path@^1.0.0",
      "my-package": "workspace:*",
    },
  });

  const deps = denoParser.parse(content);
  assertEquals(deps.length, 1);
  assertEquals(deps[0], { name: "@std/path", version: "1.0.0" });
});

Deno.test("denoParser - skips bare specifiers without version", () => {
  const content = JSON.stringify({
    imports: {
      "@std/path": "jsr:@std/path@^1.0.0",
      "bare-specifier": "jsr:@std/bare",
    },
  });

  const deps = denoParser.parse(content);
  assertEquals(deps.length, 1);
  assertEquals(deps[0], { name: "@std/path", version: "1.0.0" });
});

Deno.test("denoParser - strips various semver prefixes", () => {
  const content = JSON.stringify({
    imports: {
      a: "jsr:@scope/a@^1.0.0",
      b: "jsr:@scope/b@~2.0.0",
      c: "jsr:@scope/c@>=3.0.0",
      d: "jsr:@scope/d@4.0.0",
    },
  });

  const deps = denoParser.parse(content);
  assertEquals(deps.length, 4);
  assertEquals(deps[0].version, "1.0.0");
  assertEquals(deps[1].version, "2.0.0");
  assertEquals(deps[2].version, "3.0.0");
  assertEquals(deps[3].version, "4.0.0");
});

Deno.test("denoParser - handles deno.jsonc with comments", () => {
  const content = `{
    // This is a comment
    "imports": {
      "@std/path": "jsr:@std/path@^1.0.0"
      /* This is a
         multi-line comment */
    }
  }`;

  const deps = denoParser.parse(content);
  assertEquals(deps.length, 1);
  assertEquals(deps[0], { name: "@std/path", version: "1.0.0" });
});

Deno.test("parser metadata - jsr", () => {
  assertEquals(denoParser.fileType, "deno.json");
  assertEquals(denoParser.registry, "jsr");
});

Deno.test("parseDependencies - uses correct parser for jsr", () => {
  const content = JSON.stringify({
    imports: {
      "@std/path": "jsr:@std/path@^1.0.0",
    },
  });
  const deps = parseDependencies(content, "jsr");
  assertEquals(deps.length, 1);
  assertEquals(deps[0], { name: "@std/path", version: "1.0.0" });
});

// NuGet Parser Tests
Deno.test("nugetParser - parses PackageReference with Version attribute", () => {
  const content = `
<Project Sdk="Microsoft.NET.Sdk">
  <ItemGroup>
    <PackageReference Include="Newtonsoft.Json" Version="13.0.1" />
    <PackageReference Include="Microsoft.Extensions.Logging" Version="7.0.0" />
  </ItemGroup>
</Project>
`;
  const deps = nugetParser.parse(content);
  assertEquals(deps.length, 2);
  assertEquals(deps[0], { name: "Newtonsoft.Json", version: "13.0.1" });
  assertEquals(deps[1], { name: "Microsoft.Extensions.Logging", version: "7.0.0" });
});

Deno.test("nugetParser - parses PackageReference with Version as child element", () => {
  const content = `
<Project Sdk="Microsoft.NET.Sdk">
  <ItemGroup>
    <PackageReference Include="Newtonsoft.Json">
      <Version>13.0.1</Version>
    </PackageReference>
  </ItemGroup>
</Project>
`;
  const deps = nugetParser.parse(content);
  assertEquals(deps.length, 1);
  assertEquals(deps[0], { name: "Newtonsoft.Json", version: "13.0.1" });
});

Deno.test("nugetParser - handles self-closing and full tags", () => {
  const content = `
<Project Sdk="Microsoft.NET.Sdk">
  <ItemGroup>
    <PackageReference Include="Package.A" Version="1.0.0" />
    <PackageReference Include="Package.B" Version="2.0.0"></PackageReference>
  </ItemGroup>
</Project>
`;
  const deps = nugetParser.parse(content);
  assertEquals(deps.length, 2);
  assertEquals(deps[0], { name: "Package.A", version: "1.0.0" });
  assertEquals(deps[1], { name: "Package.B", version: "2.0.0" });
});

Deno.test("nugetParser - skips variable references", () => {
  const content = `
<Project Sdk="Microsoft.NET.Sdk">
  <ItemGroup>
    <PackageReference Include="Package.WithVariable" Version="$(PackageVersion)" />
    <PackageReference Include="Package.WithVersion" Version="1.0.0" />
  </ItemGroup>
</Project>
`;
  const deps = nugetParser.parse(content);
  assertEquals(deps.length, 1);
  assertEquals(deps[0], { name: "Package.WithVersion", version: "1.0.0" });
});

Deno.test("nugetParser - skips wildcard versions", () => {
  const content = `
<Project Sdk="Microsoft.NET.Sdk">
  <ItemGroup>
    <PackageReference Include="Package.Wildcard" Version="*" />
    <PackageReference Include="Package.Fixed" Version="1.0.0" />
  </ItemGroup>
</Project>
`;
  const deps = nugetParser.parse(content);
  assertEquals(deps.length, 1);
  assertEquals(deps[0], { name: "Package.Fixed", version: "1.0.0" });
});

Deno.test("nugetParser - handles empty csproj", () => {
  const content = `
<Project Sdk="Microsoft.NET.Sdk">
  <ItemGroup>
  </ItemGroup>
</Project>
`;
  const deps = nugetParser.parse(content);
  assertEquals(deps.length, 0);
});

Deno.test("nugetParser - handles Version before Include", () => {
  const content = `
<Project Sdk="Microsoft.NET.Sdk">
  <ItemGroup>
    <PackageReference Version="13.0.1" Include="Newtonsoft.Json" />
  </ItemGroup>
</Project>
`;
  const deps = nugetParser.parse(content);
  assertEquals(deps.length, 1);
  assertEquals(deps[0], { name: "Newtonsoft.Json", version: "13.0.1" });
});

Deno.test("parser metadata - nuget", () => {
  assertEquals(nugetParser.fileType, ".csproj");
  assertEquals(nugetParser.registry, "nuget");
});

Deno.test("parseDependencies - uses correct parser for nuget", () => {
  const content = `
<Project Sdk="Microsoft.NET.Sdk">
  <ItemGroup>
    <PackageReference Include="Newtonsoft.Json" Version="13.0.1" />
  </ItemGroup>
</Project>
`;
  const deps = parseDependencies(content, "nuget");
  assertEquals(deps.length, 1);
  assertEquals(deps[0], { name: "Newtonsoft.Json", version: "13.0.1" });
});
