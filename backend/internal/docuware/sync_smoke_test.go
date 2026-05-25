package docuware

import (
	"encoding/json"
	"fmt"
	"testing"
)

// TestExtractDefectFields_Mappings is a printf-style smoke test for the new
// hole/hanging/cavity/articleOverlap mappings introduced for the qty-fields
// fix. Not a strict assertion test — eyeballs the output. Delete once
// proper assertions are written.
func TestExtractDefectFields_Mappings(t *testing.T) {
	cases := []struct {
		name string
		cn   string
	}{
		{
			"holes + qty + noHanging + articleOverlap + cavity",
			`{"holesInadequate":true,"holesInadequateMitigation":["Vent holes required","Drain holes required"],"ventHolesQty":3,"drainHolesQty":5,"jigHolesQty":0,"enclosedCavity":true,"enclosedCavityMitigation":["Cavity Vent holes required"],"cavityVentHolesQty":2,"noHanging":true,"noHangingMitigation":["Lifting lug-nut required=4","Hang notch required=1"],"articleOverlap":true,"articleOverlapMitigation":["Article Overlap Vent Hole required=7"]}`,
		},
		{
			"paint + rust single-field mitigations",
			`{"paint":"a lot","paintMitigation":["Shotblasting required","Thinners required"],"rust":"porosity","rustMitigation":["Shotblasting required"]}`,
		},
		{
			"defect with no mitigation selected",
			`{"holesInadequate":true,"enclosedCavity":true}`,
		},
	}

	for _, c := range cases {
		fmt.Println("==", c.name)
		fields := extractDefectFields(c.cn)
		seen := map[string]string{}
		for _, f := range fields {
			seen[f.FieldName] = fmt.Sprintf("%v", f.Item)
		}
		out, _ := json.MarshalIndent(seen, "", "  ")
		fmt.Println(string(out))
		fmt.Println()
	}
}
