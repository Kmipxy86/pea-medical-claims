package main

import "testing"

func TestMoney(t *testing.T) {
	cases := map[float64]string{0: "0.00", 1850: "1,850.00", 1234567.5: "1,234,567.50", -1000: "-1,000.00"}
	for in, want := range cases {
		if got := money(in); got != want {
			t.Errorf("money(%v) = %q, want %q", in, got, want)
		}
	}
}

func TestWorkflowPermissions(t *testing.T) {
	owner := &User{ID: 1, Role: "employee"}
	reviewer := &User{ID: 2, Role: "reviewer"}
	approver := &User{ID: 3, Role: "approver"}
	selfReviewer := &User{ID: 1, Role: "reviewer"} // ผู้ตรวจที่ยื่นเรื่องของตัวเอง

	find := func(name string) action {
		for _, a := range workflow {
			if a.Name == name {
				return a
			}
		}
		t.Fatalf("no action %s", name)
		return action{}
	}
	assignee := int64(2)
	tests := []struct {
		name string
		u    *User
		t    Ticket
		act  string
		want bool
	}{
		{"owner submits draft", owner, Ticket{RequesterID: 1, Status: "draft"}, "submit", true},
		{"reviewer cannot submit for others", reviewer, Ticket{RequesterID: 1, Status: "draft"}, "submit", false},
		{"reviewer claims", reviewer, Ticket{RequesterID: 1, Status: "pending_review"}, "claim", true},
		{"no self review", selfReviewer, Ticket{RequesterID: 1, Status: "pending_review"}, "claim", false},
		{"only assignee forwards", reviewer, Ticket{RequesterID: 1, Status: "in_review", AssigneeID: &assignee}, "forward", true},
		{"unassigned reviewer cannot forward", &User{ID: 9, Role: "reviewer"}, Ticket{RequesterID: 1, Status: "in_review", AssigneeID: &assignee}, "forward", false},
		{"approver approves", approver, Ticket{RequesterID: 1, Status: "pending_approval"}, "approve", true},
		{"reviewer cannot approve", reviewer, Ticket{RequesterID: 1, Status: "pending_approval"}, "approve", false},
		{"cannot approve twice", approver, Ticket{RequesterID: 1, Status: "approved"}, "approve", false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := canDo(tc.u, &tc.t, find(tc.act)); got != tc.want {
				t.Errorf("got %v want %v", got, tc.want)
			}
		})
	}
}
