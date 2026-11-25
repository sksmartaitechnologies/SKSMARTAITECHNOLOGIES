import argparse

from certificate_store import list_enquiries


def main():
    parser = argparse.ArgumentParser(description="View website contact enquiries.")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("list", help="List saved enquiries.")
    parser.parse_args()

    enquiries = list_enquiries()
    if not enquiries:
        print("No enquiries have been received.")
        return

    for enquiry in enquiries:
        print(
            f"\nEnquiry #{enquiry['id']} — {enquiry['created_at']}\n"
            f"Name: {enquiry['full_name']}\n"
            f"Email: {enquiry['email']}\n"
            f"Phone: {enquiry['phone']}\n"
            f"Message: {enquiry['message']}"
        )


if __name__ == "__main__":
    main()
